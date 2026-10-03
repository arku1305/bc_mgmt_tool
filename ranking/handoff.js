(function(root) {
  'use strict';
  function key(person) { return person.registrationId; }
  function signature(players) { return JSON.stringify(players || []); }
  function validate(packet) {
    if (!packet || packet.schemaVersion !== 1 || !packet.event || !packet.event.eventId || !packet.event.teamId || !Array.isArray(packet.roster)) throw new Error('活動名單格式不正確');
    var names = new Set(), ids = new Set();
    packet.roster.forEach(function(p) {
      if (!p.name || !p.registrationId || !['fixed', 'guest'].includes(p.participantType) || names.has(p.name) || ids.has(key(p))) throw new Error('活動名單有人員重複或資料不完整');
      names.add(p.name); ids.add(key(p));
    });
    return packet;
  }
  function diff(packet, players, binding) {
    validate(packet);
    if (binding && (binding.eventId !== packet.event.eventId || binding.teamId !== packet.event.teamId)) throw new Error('排點已連結另一場活動；請先結束並重設排點，再匯入新活動');
    if (players.some(function(p) { return p.integrationEventId && (p.integrationEventId !== packet.event.eventId || p.teamId !== packet.event.teamId); })) throw new Error('排點人員含有其他活動或球團資料，請先整理後再匯入');
    var additions = [], removals = [], manual = [], conflicts = [];
    packet.roster.forEach(function(person) {
      var linked = players.find(function(p) { return p.integrationEventId === packet.event.eventId && p.registrationId === key(person); });
      if (linked) return;
      if (players.filter(function(p) { return p.name === person.name; }).length > 1) throw new Error('排點中有多位同名球員，請先整理後再建立對應');
      if (players.some(function(p) { return p.name === person.name; })) {
        conflicts.push({ person: person, player: players.find(function(p) { return p.name === person.name; }) }); return;
      }
      additions.push(person);
    });
    players.forEach(function(player) {
      if (player.integrationEventId !== packet.event.eventId || !player.registrationId) { manual.push(player); return; }
      if (!packet.roster.some(function(person) { return key(person) === player.registrationId; })) removals.push(player);
    });
    return { additions: additions, removals: removals, manual: manual, conflicts: conflicts };
  }
  function apply(packet, players, binding, selectedAdds, selectedRemoves, onCourtIds, selectedLinks) {
    var changes = diff(packet, players, binding);
    selectedLinks = selectedLinks || [];
    selectedLinks.forEach(function(id) { if (!changes.conflicts.some(function(c) { return key(c.person) === id; })) throw new Error('對應選擇已失效，請重新預覽'); });
    selectedAdds.forEach(function(id) { if (!changes.additions.some(function(p) { return key(p) === id; })) throw new Error('新增選擇已失效，請重新預覽'); });
    selectedRemoves.forEach(function(id) {
      if (!changes.removals.some(function(p) { return p.id === id; })) throw new Error('移除選擇已失效，請重新預覽');
      if (onCourtIds.has(id)) throw new Error('球員仍在場上，請先移出場地後再匯入');
    });
    var next = players.filter(function(p) { return !selectedRemoves.includes(p.id); }).map(function(p) {
      var link = changes.conflicts.find(function(c) { return c.player.id === p.id && selectedLinks.includes(key(c.person)); });
      if (!link) return p;
      if (p.integrationEventId && p.integrationEventId !== packet.event.eventId) throw new Error('此人員屬於另一場活動，不能對應');
      return Object.assign({}, p, { registrationId: key(link.person), integrationEventId: packet.event.eventId,
        teamId: packet.event.teamId, participantType: link.person.participantType });
    });
    changes.additions.filter(function(p) { return selectedAdds.includes(key(p)); }).forEach(function(p) {
      next.push({ id: 'import-' + packet.event.eventId + '-' + key(p), name: p.name,
        registrationId: key(p), integrationEventId: packet.event.eventId, teamId: packet.event.teamId,
        participantType: p.participantType, regular: p.participantType === 'fixed',
        seasonPass: false, checkedIn: false, paid: false, pinned: false, level: 6,
        games: 0, consecutiveGames: 0, partners: {}, opponents: {}, wantPartner: [], wantOppo: [] });
    });
    return next;
  }
  var api = { validate: validate, diff: diff, apply: apply, signature: signature };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RosterHandoff = api;
})(typeof window !== 'undefined' ? window : globalThis);

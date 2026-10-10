const { activeFixed, entriesOf, remainingOf } = require('./registration');
function render(session) {
  if (!session?.activityId) return '尚未建立活動';
  const fixed = activeFixed(session), guests = entriesOf(session);
  const lines = [`${session.teamName} 報名接龍`, `日期：${session.eventDate}`, `時間：${session.startTime}–${session.endTime}`,
    `地點：${session.location}`, ...(session.guestFee == null ? [] : [`臨打費用：${session.guestFee} 元／人`]), `場地數：${session.courtCount || 2}`,
    ...(session.shuttlecock ? [`用球：${session.shuttlecock}`] : []), `人數上限：${session.totalCapacity}`, ...(require('./activity-time').ended(session) ? ['活動已結束，停止報名'] : (session.registrationOpen ? [] : ['暫停報名'])), ...(session.message ? [session.message] : []), '📋 固定成員'];
  fixed.forEach((name, i) => lines.push(`${i + 1}. ${name}`));
  if (session.cancelledFixed?.length) lines.push('本次請假：' + session.cancelledFixed.join('、'));
  lines.push('', '🎯 臨打報名');
  guests.forEach((person, i) => lines.push(`${fixed.length + i + 1}. ${person.name}`));
  for (let i = fixed.length + guests.length + 1; i <= session.totalCapacity; i++) lines.push(`${i}.`);
  lines.push('', `剩餘空位：${Math.max(0, remainingOf(session))} 個`);
  return lines.join('\n');
}
module.exports = { render };

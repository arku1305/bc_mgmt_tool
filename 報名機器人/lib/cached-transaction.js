async function cachedTransaction(ref,update) {
  // Keep the read listener alive until the transaction finishes. A one-shot
  // read can release its cache before the SDK's initial transaction callback.
  const keepCache=()=>{};
  if(typeof ref.on==='function')ref.on('value',keepCache);
  try {
    await ref.once('value');
    return await ref.transaction(value=>update(value == null ? null : JSON.parse(JSON.stringify(value))));
  } finally {
    if(typeof ref.off==='function')ref.off('value',keepCache);
  }
}
module.exports = cachedTransaction;

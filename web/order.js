// The page hears the engine's state two ways: as the reply to what it just asked for, and as a push whenever
// something changes. Nothing orders the two. A model that answers at once has its "done" pushed before the reply
// to the request that started it (still "running") is read, and that old reply would then draw over the new
// state and leave the page waiting for good. Each state carries the engine's count (boot, seq) from when it was
// taken, so one older than a state already shown is set aside. The count restarts with the engine, so a new
// boot id starts a new count; a state with no count (an older engine) is always taken.
export function newestOnly() {
  let boot = null, seq = -1;
  return state => {
    if (typeof state?.seq !== 'number' || typeof state.boot !== 'string') return true;
    if (state.boot === boot && state.seq <= seq) return false;
    boot = state.boot; seq = state.seq;
    return true;
  };
}

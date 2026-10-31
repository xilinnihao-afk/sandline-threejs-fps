// Container edition is offline; production analytics remain in the web edition.
const noop = (..._args: unknown[]): void => {};
export const telemetry = {event: noop, setGame: noop, beginLoad: noop, loadStage: noop, ready: noop, fail: noop};

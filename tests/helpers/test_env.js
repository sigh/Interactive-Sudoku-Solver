export const ensureGlobalEnvironment = (options = {}) => {
  const {
    needWindow = false,
    windowObject,
    documentValue,
    locationValue,
    performance,
  } = options;

  const g = globalThis;

  if (!g.self) {
    g.self = g;
  }

  if (needWindow || windowObject) {
    if (!g.window) {
      g.window = windowObject || g;
    }
  }

  const hasDocumentOption = Object.prototype.hasOwnProperty.call(options, 'documentValue');
  if (hasDocumentOption) {
    g.document = documentValue;
  } else if (needWindow && typeof g.document === 'undefined') {
    g.document = {};
  }

  if (typeof g.VERSION_PARAM === 'undefined') {
    g.VERSION_PARAM = '';
  }

  const resolvedLocation = locationValue ?? (needWindow ? { search: '' } : null);
  if (resolvedLocation && !g.location) {
    g.location = resolvedLocation;
  }

  if (performance && typeof g.performance === 'undefined') {
    g.performance = performance;
  }

  if (typeof g.atob !== 'function') {
    g.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
  }
  if (typeof g.btoa !== 'function') {
    g.btoa = (binary) => Buffer.from(binary, 'binary').toString('base64');
  }
};

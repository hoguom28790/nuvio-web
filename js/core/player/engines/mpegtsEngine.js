function getMpegtsGlobal() {
  return globalThis.mpegts || null;
}

export const mpegtsEngine = {
  name: "mpegts.js",

  isSupported() {
    const mpegts = getMpegtsGlobal();
    if (!mpegts || typeof mpegts.createPlayer !== "function") {
      return false;
    }
    try {
      return Boolean(mpegts.isSupported?.());
    } catch (_) {
      return false;
    }
  },

  create(mediaDataSource, config) {
    const mpegts = getMpegtsGlobal();
    if (!mpegts) {
      return null;
    }
    return mpegts.createPlayer(mediaDataSource, config);
  },

  getEvents() {
    return getMpegtsGlobal()?.Events || {};
  }
};

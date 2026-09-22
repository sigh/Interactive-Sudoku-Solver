export const guardListExclusions = (getListExclusions) => {
  const snapshotsByInstance = new WeakMap();
  return function (cells) {
    let snapshots = snapshotsByInstance.get(this);
    if (!snapshots) {
      snapshots = new WeakMap();
      snapshotsByInstance.set(this, snapshots);
    }
    const previous = snapshots.get(cells);
    if (previous) {
      if (cells.length !== previous.length) {
        throw new Error('getListExclusions: cached cell list changed length');
      }
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] !== previous[i]) {
          throw new Error(`getListExclusions: cached cell list changed at index ${i}`);
        }
      }
    } else {
      snapshots.set(cells, Array.from(cells));
    }
    return getListExclusions.call(this, cells);
  };
};

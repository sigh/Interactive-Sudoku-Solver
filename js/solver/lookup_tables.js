const versionParam = self.location.search;
const { memoize, Base64Codec } = await import('../util.js' + versionParam);

export class LookupTables {
  static get = memoize((numValues) => {
    return new LookupTables(true, numValues);
  });

  static fromValue = (i) => {
    return 1 << (i - 1);
  };

  static fromValuesArray = (xs) => {
    let result = 0;
    for (const x of xs) {
      result |= this.fromValue(x);
    }
    return result;
  };

  static toValue(v) {
    return 32 - Math.clz32(v);
  };

  static maxValue(v) {
    return 32 - Math.clz32(v);
  };

  static minValue(v) {
    return 32 - Math.clz32(v & -v);
  };

  // Combines min and max into a single integer:
  // Layout: [min: 16 bits, max: 16 bits]
  // The extra bits allow these values to be summed to determine the total
  // of mins and maxs.
  // 16-bits ensures we won't overflow.
  // (Since we only support 16x16 grids,the max sum is 16*16*16 = 4096)
  static minMax16bitValue(v) {
    return 0x200020 - (Math.clz32(v & -v) << 16) - Math.clz32(v);
  }

  static valueRangeInclusive(v) {
    return (1 << (32 - Math.clz32(v))) - (v & -v);
  };

  static valueRangeExclusive(v) {
    return (1 << (31 - Math.clz32(v))) - ((v & -v) << 1);
  };

  static toIndex(v) {
    return 31 - Math.clz32(v);
  };

  static toValuesArray(values) {
    let result = [];
    while (values) {
      let value = values & -values;
      values ^= value;
      result.push(LookupTables.toValue(value));
    }
    return result;
  }

  constructor(do_not_call, numValues) {
    if (!do_not_call) throw ('Use LookupTables.get(shape.numValues)');

    this.allValues = (1 << numValues) - 1;
    this.combinations = 1 << numValues;

    const combinations = this.combinations;

    this.sum = (() => {
      let table = new Uint8Array(combinations);
      for (let i = 1; i < combinations; i++) {
        // SUM is the value of the lowest set bit plus the sum  of the rest.
        table[i] = table[i & (i - 1)] + LookupTables.toValue(i & -i);
      }
      return table;
    })();

    // Combines useful info about the range of numbers in a cell.
    // Designed to be summed, so that the aggregate stats can be found.
    // Layout: [isFixed: 4 bits, fixed: 8 bits, min: 8 bits, max: 8 bits]
    //
    // Sum of isFixed gives the number of fixed cells.
    // Sum of fixed gives the sum of fixed cells.
    this.rangeInfo = (() => {
      const table = new Uint32Array(combinations);
      for (let i = 1; i < combinations; i++) {
        const max = LookupTables.maxValue(i);
        const min = LookupTables.minValue(i);
        const fixed = (i & (i - 1)) ? 0 : LookupTables.toValue(i);
        const isFixed = fixed ? 1 : 0;
        table[i] = ((isFixed << 24) | (fixed << 16) | (min << 8) | max);
      }
      // If there are no values, set a high value for isFixed to indicate the
      // result is invalid. This is intended to be detectable after summing.
      table[0] = numValues << 24;
      return table;
    })();

    this.reverse = (() => {
      let table = new Uint16Array(combinations);
      for (let i = 1; i <= numValues; i++) {
        table[LookupTables.fromValue(i)] =
          LookupTables.fromValue(numValues + 1 - i);
      }
      for (let i = 1; i < combinations; i++) {
        table[i] = table[i & (i - 1)] | table[i & -i];
      }
      return table;
    })();

    const NUM_BITS_BASE64 = 6;
    const keyArr = new Uint8Array(
      Base64Codec.lengthOf6BitArray(numValues * numValues));

    this.forBinaryKey = memoize((key) => {
      const table = new Uint16Array(combinations);
      const tableInv = new Uint16Array(combinations);

      keyArr.fill(0);
      Base64Codec.decodeTo6BitArray(key, keyArr);

      // Populate base cases, where there is a single value set.
      let keyIndex = 0;
      let vIndex = 0;
      for (let i = 0; i < numValues; i++) {
        for (let j = 0; j < numValues; j++) {
          const v = keyArr[keyIndex] & 1;
          table[1 << i] |= v << j;
          tableInv[1 << j] |= v << i;

          keyArr[keyIndex] >>= 1;
          if (++vIndex == NUM_BITS_BASE64) {
            vIndex = 0;
            keyIndex++;
          }
        }
      }

      // To fill in the rest, OR together all the valid settings for each value
      // set.
      for (let i = 1; i < combinations; i++) {
        table[i] = table[i & (i - 1)] | table[i & -i];
        tableInv[i] = tableInv[i & (i - 1)] | tableInv[i & -i];
      }
      return [table, tableInv];
    });
  }
}

const binaryFnTo6BitArray = (fn, numValues) => {
  const NUM_BITS = 6;
  const array = [];

  let v = 0;
  let vIndex = 0;
  for (let i = 1; i <= numValues; i++) {
    for (let j = 1; j <= numValues; j++) {
      v |= (!!fn(i, j)) << vIndex;
      if (++vIndex == NUM_BITS) {
        array.push(v);
        vIndex = 0;
        v = 0;
      }
    }
  }
  array.push(v);

  // Trim trailing zeros.
  while (array.length && !array[array.length - 1]) array.pop();

  return array;
}

export const binaryFnToKey = (fn, numValues) => {
  const array = binaryFnTo6BitArray(fn, numValues);
  return Base64Codec.encode6BitArray(array);
}
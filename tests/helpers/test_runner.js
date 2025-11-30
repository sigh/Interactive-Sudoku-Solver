export const runTest = async (name, fn) => {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
};

export const logSuiteComplete = (suiteName) => {
  console.log(`All ${suiteName} tests passed.`);
};

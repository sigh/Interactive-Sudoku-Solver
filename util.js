const afterRedraw = async (fn) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(fn());
    });
  });
};

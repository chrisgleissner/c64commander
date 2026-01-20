const moduleShim = {};

export const createRequire = () => {
  throw new Error('createRequire is not supported in the browser.');
};

export default moduleShim;

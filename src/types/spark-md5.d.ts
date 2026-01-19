declare module 'spark-md5' {
  const SparkMD5: {
    ArrayBuffer: {
      hash: (buffer: ArrayBuffer) => string;
    };
  };
  export default SparkMD5;
}

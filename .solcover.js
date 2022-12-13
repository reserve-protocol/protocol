module.exports = {
  skipFiles: [
    'mocks',
    'test',
    'prod/test',
    'libraries/Fixed.sol',
    'libraries/test',
    'p0/test',
    'p0/mocks',
    'p1/test',
    'p1/mocks',
    'p2/test',
    'p2/mocks',
    'plugins/mocks',
    'plugins/aave',
    'fuzz',
  ],
  configureYulOptimizer: true,
  solcOptimizerDetails: {
    yul: true,
    yulDetails: {
      stackAllocation: true,
    },
  },
}

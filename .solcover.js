module.exports = {
  skipFiles: [
    'mocks',
    'test',
    'vendor',
    'libraries/Fixed.sol',
    'libraries/test',
    'plugins/mocks',
    'plugins/assets/aave/vendor',
    'plugins/assets/ankr/vendor',
    'plugins/assets/compoundv3/vendor',
    'plugins/assets/curve/cvx/vendor',
    'plugins/assets/frax-eth/vendor',
    'plugins/assets/lido/vendor',
    'plugins/assets/rocket-eth/vendor',
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

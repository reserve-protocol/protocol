import hre from 'hardhat'

export const getResetFork = (forkBlock: number) => {
    return async () => {
        // Need to reset state since running the whole test suites to all
        // test cases in this file to fail. Strangely, all test cases
        // pass when running just this file alone.
        await hre.network.provider.request({
          method: 'hardhat_reset',
          params: [
            {
              forking: {
                jsonRpcUrl: process.env.MAINNET_RPC_URL,
                blockNumber: forkBlock,
              },
            },
          ],
        })
    }
}
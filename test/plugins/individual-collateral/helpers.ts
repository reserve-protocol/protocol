import { getLatestBlockTimestamp } from '#/test/utils/time'
import hre from 'hardhat'
import { getLatestBlockNumber } from '../../utils/time';

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

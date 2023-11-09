import { getLatestBlockNumber, getLatestBlockTimestamp } from '#/utils/time';
import { task } from 'hardhat/config'

task('automine', 'Sends ETH to an address')
    .setAction(async (params, hre) => {
        await hre.network.provider.request({
            method: "evm_setAutomine",
            params: [true],
        });
        // await hre.network.provider.request({
        //     method: "evm_setIntervalMining",
        //     params: [4],
        // });
    })

task('get-block')
    .setAction(async (params, hre) => {
        const block = await getLatestBlockNumber(hre)
        const ts = await getLatestBlockTimestamp(hre)
        console.log(block, ts)
    })
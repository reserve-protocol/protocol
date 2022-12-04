import { BigNumber, utils } from 'ethers'
import { bn, fp } from '../../../common/numbers'

import {
    IConfig,
    IRevenueShare,
    IRTokenConfig,
  } from '../../../common/configuration'


export interface ITestParams {
    eulAddr?: string
    tokenAddr?: string
    etokenAddr?: string
    tokenChainlinkFeed?: string
    refUnitChainlinkFeed?: string
    targetChainlinkFeed?: string
    etokenHolderAddr: string
    targetName: string
    refPerTok: BigNumber
    refPerTok1: BigNumber
    delta: BigNumber
    issueAmount: BigNumber
    oneUnit: BigNumber
    fallBackPrice: BigNumber
}

    export const eTokenHolders = {
        edai: "0x2562DD39af7440b63EEf5549D9486A4066C328B7",
        eusdc: "0x1ec0dde402dae69021492e7a9c4cbfdf72ffd84a",
        eusdt: "0x178b390cafd29cc969ca60eef5d5484a8ba83f74",
        ewbtc: "0x6780ac060fdcba20ae02a6197c84bdc70cf8716b",
        eweth: "0xA29332b560103d52F758B978E0661420A9D40CB5",
        ewsteth: "0xd275e5cb559d6dc236a5f8002a5f0b4c8e610701",
        euni: "0x139776871Ee95f55d20b10d9Ba5a0385451066cd",
        elink: "0xbDfA4f4492dD7b7Cf211209C4791AF8d52BF5c50",
      }
  
    export const targetName = {
        usd: utils.formatBytes32String('USD'),
        btc: utils.formatBytes32String('BTC'),
        eth: utils.formatBytes32String('ETH'),
        uni: utils.formatBytes32String('UNI'),
        link: utils.formatBytes32String('LINK'),
    }

    export const etokenRefPerTok = {
        // Forked: Block 15400000
        edai: fp('1.015'),
        eusdc: fp('1.019'),
        eusdt: fp('1.019'),
        ewbtc: fp('1.0084'),
        eweth: fp('1.008'),
        ewsteth: fp('1.007'),
        euni: fp('1.006'),
        elink: fp('1.0168'),
        // Advanced: Block 115410034
        edai1: fp('1.065'),
        eusdc1: fp('1.097'),
        eusdt1: fp('1.278'),
        ewbtc1: fp('1.0094'),
        eweth1: fp('1.058'),
        ewsteth1: fp('1.115'),
        euni1: fp('1.037'),
        elink1: fp('1.0168'),
      }

    // apx 1%
    export const delta = {
        usd: fp('0.001'),
        wbtc: fp('214'),
        weth: fp('16'),
        wsteth: fp('17'),
        uni: fp('0.07'),
        link: fp('0.07'),
    }
    
    export const issueAmount = {
        usd: bn('5000e18'),
        wbtc: bn('3e18'), 
        weth: bn('20e18'), 
        wsteth: bn('20e18'), 
        uni: bn('1500e18'), 
        link: bn('1500e18'), 
    }
  
     export const tokenOneUnit = {
        erc18: bn('1e18'),
        erc8: bn('1e8'),
        erc6: bn('1e6'),
      }

      export const fallBackPrice = {
        usd: fp('1'),
        wbtc: fp('21400'),
        weth: fp('1634'),
        wsteth: fp('1729'),
        uni: fp('7.03'),
        link: fp('7.127')
      }

        // RToken Configuration
     const dist: IRevenueShare = {
       rTokenDist: bn(40), // 2/5 RToken
       rsrDist: bn(60), // 3/5 RSR
    }

    // --- RToken Params

    export const config: IConfig = {
        dist: dist,
        minTradeVolume: fp('1e4'), // $10k
        rTokenMaxTradeVolume: fp('1e6'), // $1M
        shortFreeze: bn('259200'), // 3 days
        longFreeze: bn('2592000'), // 30 days
        rewardPeriod: bn('604800'), // 1 week
        rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
        unstakingDelay: bn('1209600'), // 2 weeks
        tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
        auctionLength: bn('900'), // 15 minutes
        backingBuffer: fp('0.0001'), // 0.01%
        maxTradeSlippage: fp('0.01'), // 1%
        issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
        scalingRedemptionRate: fp('0.05'), // 5%
        redemptionRateFloor: fp('1e6'), // 1M RToken
      }

        // Set parameters
    export const rTokenConfig: IRTokenConfig = {
            name: 'RTKN RToken',
            symbol: 'RTKN',
            mandate: 'mandate',
            params: config,
    }

    export const BN1 : BigNumber = bn('1e18')
    export const FP1 : BigNumber = fp('1')
      
    
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
    refChainLinkFeed?: string
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
        eDAI: "0x2562DD39af7440b63EEf5549D9486A4066C328B7",
        eUSDC: "0x1ec0dde402dae69021492e7a9c4cbfdf72ffd84a",
        eUSDT: "0x178b390cafd29cc969ca60eef5d5484a8ba83f74",
        eWBTC: "0x6780ac060fdcba20ae02a6197c84bdc70cf8716b",
        eWETH: "0xA29332b560103d52F758B978E0661420A9D40CB5",
        eWSTETH: "0xd275e5cb559d6dc236a5f8002a5f0b4c8e610701",
        eUNI: "0x139776871Ee95f55d20b10d9Ba5a0385451066cd",
        eLINK: "0xbDfA4f4492dD7b7Cf211209C4791AF8d52BF5c50",
      }
  
    export const targetName = {
        USD: utils.formatBytes32String('USD'),
        BTC: utils.formatBytes32String('BTC'),
        ETH: utils.formatBytes32String('ETH'),
        UNI: utils.formatBytes32String('UNI'),
        LINK: utils.formatBytes32String('LINK'),
    }

    export const etokenRefPerTok = {
        // Forked: Block 15400000
        eDAI: fp('1.015'),
        eUSDC: fp('1.019'),
        eUSDT: fp('1.019'),
        eWBTC: fp('1.0084'),
        eWETH: fp('1.008'),
        eWSTETH: fp('1.091'),
        eUNI: fp('1.006'),
        eLINK: fp('1.0168'),
        // Advanced: Block 115410034
        eDAI1: fp('1.065'),
        eUSDC1: fp('1.097'),
        eUSDT1: fp('1.278'),
        eWBTC1: fp('1.0094'),
        eWETH1: fp('1.058'),
        eWSTETH1: fp('1.21'),
        eUNI1: fp('1.037'),
        eLINK1: fp('1.0168'),
      }

    // apx 1%
    export const delta = {
        USD: fp('0.001'),
        WBTC: fp('214'),
        WETH: fp('16'),
        WSTETH: fp('17'),
        UNI: fp('0.07'),
        LINK: fp('0.07'),
    }
    
    export const issueAmount = {
        USD: bn('5000e18'),
        WBTC: bn('3e18'), 
        WETH: bn('20e18'), 
        WSTETH: bn('20e18'), 
        UNI: bn('1500e18'), 
        LINK: bn('1500e18'), 
    }
  
     export const tokenOneUnit = {
        ERC18: bn('1e18'),
        ERC8: bn('1e8'),
        ERC6: bn('1e6'),
      }

      export const fallBackPrice = {
        USD: fp('1'),
        WBTC: fp('21400'),
        WETH: fp('1634'),
        WSTETH: fp('1729'),
        UNI: fp('7.03'),
        LINK: fp('7.127')
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
      
    
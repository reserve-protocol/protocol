const { ZERO_ADDRESS } = require("../common/constants");

const networkConfig = {
    default: {
        name: 'hardhat',
    },
    31337: {
        name: 'localhost',
    },
    3: {
        name: 'ropsten',
        rsrPrev: '0x58408daf0664dc9ff4645414ce5f9ace059f0470',
        compoundMath: '0x2C3E02b6A137F3ac194952B7ea3763631984E49B',
        slowWallet: '0x9d2e46f086be2f76d576c95409344550a6ffd24a',
        multisigWallet: '0xA7b123D54BcEc14b4206dAb796982a6d5aaA6770',
        USDC: '0x07865c6e87b9f70255377e024ace6630c1eaa37f',
    },
    1: {
        name: 'mainnet',
        rsrPrev: '0x8762db106b2c2a0bccb3a80d1ed41273552616e8',
        slowWallet: '0x82734Ae1E495d6e67bF12F2153659a0F74d2874B',
        multisigWallet: '0xA7b123D54BcEc14b4206dAb796982a6d5aaA6770',
        USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    }
}

const developmentChains = ["hardhat", "localhost"]

const rTokenConfig = {
    default: {
        name: "RToken",
        symbol: "RTKN",
        params: {
            stakingDepositDelay: 0,
            stakingWithdrawalDelay: 0,
            maxSupply: 0,
            minMintingSize: 0,
            issuanceRate: 0,
            rebalancingFreezeCost: 0,
            insurancePaymentPeriod: 0,
            expansionPerSecond: 0,
            expenditureFactor: 0,
            spread: 0,
            exchange: ZERO_ADDRESS,
            circuitBreaker: ZERO_ADDRESS,
            txFeeCalculator: ZERO_ADDRESS,
            insurancePool: ZERO_ADDRESS,
            protocolFund: ZERO_ADDRESS
        },
        basketTokens: [
            {
                tokenAddress: ZERO_ADDRESS,
                genesisQuantity: 0,
                rateLimit: 1,
                maxTrade: 1,
                priceInRToken: 0,
                slippageTolerance: 0
            }
        ],
        rsr: {
            tokenAddress: ZERO_ADDRESS,
            genesisQuantity: 0,
            rateLimit: 1,
            maxTrade: 1,
            priceInRToken: 0,
            slippageTolerance: 0
        }
    }
}

const getRTokenConfig = (name) => {
    if (!rTokenConfig[name]) {
        throw new Error(`Configuration ${name} not available`);
    }
    return rTokenConfig[name];
}

module.exports = {
    networkConfig,
    developmentChains,
    getRTokenConfig
}

const { BigNumber } = require("ethers");

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ONE_ETH= BigNumber.from("1000000000000000000");

const MAX_UINT256 = BigNumber.from(2).pow(256).sub(1);
const SCALE_FACTOR = 1e18;

module.exports = {
    ZERO_ADDRESS,
    MAX_UINT256,
    SCALE_FACTOR,
    ONE_ETH
};

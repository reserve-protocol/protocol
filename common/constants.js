const { BigNumber } = require("ethers");

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ONE_ETH= BigNumber.from("1000000000000000000");

const MAX_UINT256 = BigNumber.from(2).pow(256).sub(1);
const MAX_UINT16 = (2**16) - 1;

const SCALE_FACTOR = 1e18;
const BN_SCALE_FACTOR = BigNumber.from(SCALE_FACTOR.toString());

module.exports = {
    ZERO_ADDRESS,
    MAX_UINT256,
    MAX_UINT16,
    SCALE_FACTOR,
    BN_SCALE_FACTOR,
    ONE_ETH
};

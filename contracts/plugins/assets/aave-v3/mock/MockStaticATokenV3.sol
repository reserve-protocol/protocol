// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import { StaticATokenV3LM, IPool, IRewardsController } from "../vendor/StaticATokenV3LM.sol";

contract MockStaticATokenV3LM is StaticATokenV3LM {
    uint256 customRate;

    constructor(IPool pool, IRewardsController rewardsController)
        StaticATokenV3LM(pool, rewardsController)
    {}

    function rate() public view override returns (uint256) {
        if (customRate != 0) {
            return customRate;
        }

        return POOL.getReserveNormalizedIncome(_aTokenUnderlying);
    }

    function mock_setCustomRate(uint256 _customRate) external {
        customRate = _customRate;
    }
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.19;

import { StaticATokenV3LM, IPool, IRewardsController } from "../vendor/StaticATokenV3LM.sol";

contract MockStaticATokenV3LM is StaticATokenV3LM {
    uint256 public customRate;

    /* solhint-disable no-empty-blocks */
    constructor(IPool pool, IRewardsController rewardsController)
        StaticATokenV3LM(pool, rewardsController)
    {}

    /* solhint-enable no-empty-blocks */

    function rate() public view override returns (uint256) {
        if (customRate != 0) {
            return customRate;
        }

        return POOL.getReserveNormalizedIncome(_aTokenUnderlying);
    }

    function mockSetCustomRate(uint256 _customRate) external {
        customRate = _customRate;
    }
}

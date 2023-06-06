// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.6.12;

import "@aave/protocol-v2/contracts/protocol/tokenization/AToken.sol";
import "../assets/aave/vendor/IAaveIncentivesController.sol";

contract ATokenNoController is AToken {
    constructor(
        ILendingPool pool,
        address underlyingAssetAddress,
        address reserveTreasuryAddress,
        string memory tokenName,
        string memory tokenSymbol,
        address incentivesController
    )
        public
        AToken(
            pool,
            underlyingAssetAddress,
            reserveTreasuryAddress,
            tokenName,
            tokenSymbol,
            incentivesController
        )
    {}

    function getIncentivesController() external pure returns (IAaveIncentivesController) {
        return IAaveIncentivesController(address(0));
    }
}

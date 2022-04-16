// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";
import "contracts/plugins/assets/abstract/Collateral.sol";
import "contracts/libraries/Fixed.sol";

contract InvalidATokenFiatCollateralMock is AaveOracleMixin, Collateral {
    using FixLib for int192;

    IERC20 public immutable override rewardERC20;

    constructor(
        IERC20Metadata erc20_,
        int192 maxTradeVolume_,
        int192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_,
        IERC20 rewardERC20_
    )
        Collateral(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20_,
            bytes32(bytes("USD"))
        )
        AaveOracleMixin(comptroller_, aaveLendingPool_)
    {
        rewardERC20 = rewardERC20_;
    }

    /// Dummy implementation
    function price() public view virtual returns (int192) {
        return FIX_ONE;
    }

    /// Dummy implementation
    function isReferenceDepegged() private pure returns (bool) {
        return false;
    }

    /// Invalid claim calldata
    function getClaimCalldata() external pure override returns (address _to, bytes memory _cd) {
        _to = address(0);
        _cd = abi.encodeWithSignature("claimRewardsToSelf(bool)", true);
    }
}

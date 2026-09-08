// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "./ERC20Mock.sol";

/// @dev Configurable ERC4626 pricing surface; minting is independent of assets for tests.
contract ERC4626Mock is ERC20Mock {
    address public immutable asset;
    uint8 private immutable shareDecimals;
    uint256 public assetsPerShare;
    uint8 public revertMode;

    constructor(
        address asset_,
        uint8 shareDecimals_,
        uint256 assetsPerShare_
    ) ERC20Mock("Mock vault", "VAULT") {
        asset = asset_;
        shareDecimals = shareDecimals_;
        assetsPerShare = assetsPerShare_;
    }

    function decimals() public view override returns (uint8) {
        return shareDecimals;
    }

    function setAssetsPerShare(uint256 value) external {
        assetsPerShare = value;
    }

    function setRevertMode(uint8 value) external {
        revertMode = value;
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        require(revertMode != 1, "wrapper unavailable");
        // solhint-disable-next-line reason-string
        if (revertMode == 2) revert();
        return Math.mulDiv(shares, assetsPerShare, 10**shareDecimals);
    }
}

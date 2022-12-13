// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// External Interface for MCTokens
// See: https://github.com/morpho-dao/morpho-tokenized-vaults/blob/main/src/compound/interfaces/ISupplyVault.sol
interface IMCToken is IERC20Metadata {
    function claimRewards(address _user) external returns (uint256);

    function deposit(uint256 assets, address receiver) external returns (uint256);

    function mint(uint256 shares, address receiver) external returns (uint256);

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256);

    function convertToAssets(uint256 shares) external view returns (uint256 assets);

    function poolToken() external view returns (address);
}

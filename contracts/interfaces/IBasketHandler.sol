// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "./IAsset.sol";
import "./IComponent.sol";

interface IBasketHandler is IComponent {
    /// Emitted when the prime basket is set
    /// @param erc20s The collateral tokens for the prime basket
    /// @param targetAmts {target/BU} A list of quantities of target unit per basket unit
    event PrimeBasketSet(IERC20Metadata[] erc20s, Fix[] targetAmts);

    /// Emitted when the reference basket is set
    /// @param erc20s The list of collateral tokens in the reference basket
    /// @param refAmts {ref/BU} The reference amounts of the basket collateral tokens
    event BasketSet(IERC20Metadata[] erc20s, Fix[] refAmts);

    /// Emitted when a backup config is set for a target unit
    /// @param targetName The name of the target unit as a bytes32
    /// @param max The max number to use from `erc20s`
    /// @param erc20s The set of backup collateral tokens
    event BackupConfigSet(bytes32 indexed targetName, uint256 indexed max, IERC20Metadata[] erc20s);

    /// Set the prime basket
    /// @param erc20s The collateral tokens for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    function setPrimeBasket(IERC20Metadata[] memory erc20s, Fix[] memory targetAmts) external;

    /// Set the backup configuration for a given target
    /// @param targetName The name of the target as a bytes32
    /// @param max The maximum number of collateral tokens to use from this target
    /// @param erc20s A list of ordered backup collateral tokens
    function setBackupConfig(
        bytes32 targetName,
        uint256 max,
        IERC20Metadata[] calldata erc20s
    ) external;

    function forceCollateralUpdates() external;

    function ensureValidBasket() external;

    function switchBasket() external returns (bool);

    function fullyCapitalized() external view returns (bool);

    function worstCollateralStatus() external view returns (CollateralStatus status);

    function basketQuantity(IERC20Metadata erc20) external view returns (Fix);

    function basketQuote(Fix amount, RoundingApproach rounding)
        external
        view
        returns (address[] memory erc20s, uint256[] memory quantities);

    function basketsHeldBy(address account) external view returns (Fix baskets);

    function basketPrice() external view returns (Fix price);

    function basketNonce() external view returns (uint256);
}

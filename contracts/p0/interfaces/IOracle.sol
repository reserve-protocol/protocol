// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

interface IComptroller {
    function oracle() external view returns (ICompoundOracle);

    function claimComp(address holder) external;
}

interface ICompoundOracle {
    /// @return {microUSD/tok} The USD price of the corresponding token with 6 decimals.
    function price(string memory symbol) external view returns (uint256);
}

interface IAaveLendingPool {
    function getAddressesProvider() external view returns (ILendingPoolAddressesProvider);
}

interface ILendingPoolAddressesProvider {
    function getPriceOracle() external view returns (IAaveOracle);
}

interface IAaveOracle {
    // solhint-disable-next-line func-name-mixedcase
    function WETH() external view returns (address);

    /// @return {qETH/tok} The price of the `token` in ETH with 18 decimals
    function getAssetPrice(address token) external view returns (uint256);
}

interface IOracle {
    /// @return p {attoUSD/tok} The attoUSD price of a whole token
    function consult(IERC20Metadata erc20) external view returns (Fix p);
}

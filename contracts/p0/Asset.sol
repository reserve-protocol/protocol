// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";

contract AssetP0 is IAsset, Context {
    using FixLib for Fix;

    IERC20Metadata public immutable override erc20;
    IMain public immutable main;
    IOracle public override oracle;

    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_
    ) {
        erc20 = erc20_;
        main = main_;
        oracle = oracle_;
    }

    // solhint-disable no-empty-blocks

    /// @dev Intended to be used via delegatecall
    function claimAndSweepRewards(ICollateral, IMain) external virtual override {}

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (Fix) {
        return oracle.consult(erc20);
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override returns (bool) {
        return false;
    }

    function setOracle(IOracle newOracle) external {
        require(_msgSender() == main.owner(), "only main.owner");
        if (oracle != newOracle) {
            emit OracleChanged(oracle, newOracle);
            oracle = newOracle;
        }
    }
}

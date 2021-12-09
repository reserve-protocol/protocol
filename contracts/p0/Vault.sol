// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/assets/collateral/ATokenCollateral.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/libraries/Rewards.sol";
import "contracts/libraries/Fixed.sol";

// import "hardhat/console.sol";

/*
 * @title VaultP0
 * @notice An issuer of an internal bookkeeping unit called a BU or basket unit.
 */
contract VaultP0 is IVault, Ownable {
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    // {BU} = 1e18{qBU}
    uint8 public constant override BU_DECIMALS = 18;

    Basket internal _basket;

    mapping(address => mapping(address => uint256)) internal _allowances; // {qBU}
    mapping(address => uint256) public override basketUnits; // {qBU}
    uint256 public totalUnits; // {qBU}

    IVault[] public backups;

    IMain public main;

    /// @param quantities {qTok/BU}
    constructor(
        ICollateral[] memory collateral,
        uint256[] memory quantities,
        IVault[] memory backupVaults
    ) {
        require(collateral.length == quantities.length, "arrays must match in length");

        // Set default immutable basket
        _basket.size = collateral.length;
        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.collateral[i] = collateral[i];
            _basket.quantities[collateral[i]] = quantities[i];
        }

        backups = backupVaults;
    }

    /// Transfers collateral in and issues a quantity of BUs to the caller
    /// @param to The account to credit with BUs
    /// @param amtBUs {qBU} The quantity of BUs to issue
    function issue(address to, uint256 amtBUs) external override {
        require(amtBUs > 0, "Cannot issue zero");
        require(_basket.size > 0, "Empty basket");

        uint256[] memory amounts = backingAmounts(amtBUs);

        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.collateral[i].erc20().safeTransferFrom(_msgSender(), address(this), amounts[i]);
        }

        basketUnits[to] += amtBUs;
        totalUnits += amtBUs;
        emit BUsIssued(to, _msgSender(), amtBUs);
    }

    /// Redeems a quantity of BUs and transfers collateral out
    /// @param to The account to transfer collateral to
    /// @param amtBUs {qBU} The quantity of BUs to redeem
    function redeem(address to, uint256 amtBUs) external override {
        require(amtBUs > 0, "Cannot redeem zero");
        require(amtBUs <= basketUnits[_msgSender()], "Not enough units");
        require(_basket.size > 0, "Empty basket");

        uint256[] memory amounts = backingAmounts(amtBUs);

        basketUnits[_msgSender()] -= amtBUs;
        totalUnits -= amtBUs;

        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.collateral[i].erc20().safeTransfer(to, amounts[i]);
        }
        emit BUsRedeemed(to, _msgSender(), amtBUs);
    }

    /// Claims and sweeps all COMP/AAVE rewards
    function claimAndSweepRewards() external override {
        RewardsLib.claimAndSweepRewards(main);
    }

    /// @param amtBUs {qBU}
    /// @return amounts {qTok} A list of token quantities required in order to issue `amtBUs`
    function backingAmounts(uint256 amtBUs)
        public
        view
        override
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](_basket.size);
        for (uint256 i = 0; i < _basket.size; i++) {
            // {qTok} = {qBU} *  {qTok/BU} / {qBU/BU}
            amounts[i] = toFix(amtBUs)
            .shiftLeft(-int8(BU_DECIMALS))
            .mulu(_basket.quantities[_basket.collateral[i]])
            .toUintCeil();
        }
    }

    /// @return {qTok/BU} The quantity of tokens of `asset` required per whole BU
    function quantity(IAsset asset) external view override returns (uint256) {
        return _basket.quantities[asset];
    }

    /// @return sum {attoUSD/BU} The attoUSD value of 1 BU if all fiatcoins hold peg
    function basketRate() external view override returns (Fix sum) {
        for (uint256 i = 0; i < _basket.size; i++) {
            ICollateral a = _basket.collateral[i];

            // {attoUSD/BU} = {attoUSD/BU} + {attoUSD/qTok} * {qTok/BU}
            sum = sum.plus(a.rateUSD().mulu(_basket.quantities[a]));
        }
    }

    /// @return Whether the vault is made up only of collateral in `collateral`
    function containsOnly(ICollateral[] memory collateral) external view override returns (bool) {
        for (uint256 i = 0; i < _basket.size; i++) {
            bool found = false;
            for (uint256 j = 0; j < collateral.length; j++) {
                if (_basket.collateral[i] == collateral[j]) {
                    found = true;
                }
            }
            if (!found) {
                return false;
            }
        }
        return true;
    }

    /// @return {qBU} The maximum number of basket units that `issuer` can issue
    function maxIssuable(address issuer) external view override returns (uint256) {
        Fix min = FIX_MAX;
        for (uint256 i = 0; i < _basket.size; i++) {
            // {BU} = {qTok} / {qTok/BU}
            Fix amtBUs = toFix(_basket.collateral[i].erc20().balanceOf(issuer)).divu(
                _basket.quantities[_basket.collateral[i]]
            );
            if (amtBUs.lt(min)) {
                min = amtBUs;
            }
        }
        return min.shiftLeft(int8(BU_DECIMALS)).toUintFloor();
    }

    /// @return The collateral asset at `index`
    function collateralAt(uint256 index) external view override returns (ICollateral) {
        return _basket.collateral[index];
    }

    /// @return The size of the basket
    function size() external view override returns (uint256) {
        return _basket.size;
    }

    /// @return A list of eligible backup vaults
    function getBackups() external view override returns (IVault[] memory) {
        return backups;
    }

    function setBackups(IVault[] memory backupVaults) external onlyOwner {
        backups = backupVaults;
    }

    function setMain(IMain main_) external override onlyOwner {
        main = main_;
    }
}

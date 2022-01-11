// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/assets/ATokenCollateral.sol";
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
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    // {BU} = 1e18{qBU}
    uint8 public constant override BU_DECIMALS = 18;

    Basket internal _basket;

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

        uint256[] memory amounts = quote(amtBUs, RoundingApproach.CEIL);

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

        uint256[] memory amounts = quote(amtBUs, RoundingApproach.FLOOR);

        basketUnits[_msgSender()] -= amtBUs;
        totalUnits -= amtBUs;

        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.collateral[i].erc20().safeTransfer(to, amounts[i]);
        }
        emit BUsRedeemed(to, _msgSender(), amtBUs);
    }

    /// Transfers a quantity of BUs to an address from msg.sender's account, like in ERC20
    /// @param to The account to send BUs to
    function transfer(address to, uint256 amtBUs) external override {
        require(amtBUs > 0, "Cannot redeem zero");
        require(amtBUs <= basketUnits[_msgSender()], "Not enough units");
        basketUnits[_msgSender()] -= amtBUs;
        basketUnits[to] += amtBUs;
        emit BUsTransferred(_msgSender(), to, amtBUs);
    }

    /// Claims and sweeps all COMP/AAVE rewards
    function claimAndSweepRewards() external override {
        RewardsLib.claimAndSweepRewards(main);
    }

    /// @param amtBUs {qBU}
    /// @return amounts {qTok} A list of token quantities required in order to issue `amtBUs`
    function quote(uint256 amtBUs, RoundingApproach rounding)
        public
        view
        override
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](_basket.size);
        for (uint256 i = 0; i < _basket.size; i++) {
            // {qTok} = {qBU} * {qTok/BU} / {qBU/BU}
            amounts[i] = toFix(amtBUs)
            .mulu(_basket.quantities[_basket.collateral[i]])
            .shiftLeft(-int8(BU_DECIMALS))
            .toUint(rounding);
        }
    }

    /// @return {qTok/BU} The quantity of qTokens of `asset` required per whole BU
    function quantity(IAsset asset) external view override returns (uint256) {
        return _basket.quantities[asset];
    }

    /// @return attoUSD {attoUSD/BU} The price of 1 whole BU in a single unit of account
    function basketPrice(UoA uoa) external view override returns (Fix attoUSD) {
        require(uoa == UoA.USD, "conversions across units of account not implemented yet");
        for (uint256 i = 0; i < _basket.size; i++) {
            ICollateral a = _basket.collateral[i];

            // {attoUSD/BU} = {attoUSD/BU} + {attoUoQ/qTok} * {qTok/BU}
            require(a.uoa() == UoA.USD, "conversions across units of account not implemented yet");
            attoUSD = attoUSD.plus(a.price().mulu(_basket.quantities[a]));
        }
    }

    /// @return {qBU} The maximum number of basket units that `issuer` can issue
    function maxIssuable(address issuer) external view override returns (uint256) {
        Fix min = FIX_MAX;
        for (uint256 i = 0; i < _basket.size; i++) {
            // {qTok}
            Fix bal = toFix(_basket.collateral[i].erc20().balanceOf(issuer));
            // {BU} = {qTok} / {qTok/BU}
            Fix amtBUs = bal.divu(_basket.quantities[_basket.collateral[i]]);
            if (amtBUs.lt(min)) {
                min = amtBUs;
            }
        }
        return min.shiftLeft(int8(BU_DECIMALS)).floor();
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

    /// @return status The maximum CollateralStatus among vault collateral
    function collateralStatus() external view returns (CollateralStatus status) {
        for (uint256 i = 0; i < _basket.size; i++) {
            if (!main.isRegistered(_basket.collateral[i])) {
                return CollateralStatus.DISABLED;
            }
            if (uint256(_basket.collateral[i].status()) > uint256(status)) {
                status = _basket.collateral[i].status();
            }
        }
    }

    function setBackups(IVault[] memory backupVaults) external onlyOwner {
        backups = backupVaults;
    }

    function setMain(IMain main_) external override onlyOwner {
        main = main_;
    }
}

// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/proto0/assets/AAVEAssetP0.sol";
import "contracts/proto0/assets/ATokenAssetP0.sol";
import "contracts/proto0/interfaces/IAsset.sol";
import "contracts/proto0/interfaces/IMain.sol";
import "contracts/proto0/interfaces/IVault.sol";
import "contracts/libraries/Fixed.sol";

/*
 * @title VaultP0
 * @notice An issuer of an internal bookkeeping unit called a BU or basket unit.
 */
contract VaultP0 is IVault, Ownable {
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    uint8 public constant override BU_DECIMALS = 18;

    Basket internal _basket;

    mapping(address => mapping(address => uint256)) internal _allowances;
    mapping(address => uint256) public override basketUnits;
    uint256 public totalUnits;

    IVault[] public backups;

    IMain public main;

    // {BU} = 1e18{qBU}

    constructor(
        IAsset[] memory assets,
        uint256[] memory quantities, // {qTok/BU}
        IVault[] memory backupVaults
    ) {
        require(assets.length == quantities.length, "arrays must match in length");

        // Set default immutable basket
        _basket.size = assets.length;
        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.assets[i] = assets[i];
            _basket.quantities[assets[i]] = quantities[i];
        }

        backups = backupVaults;
    }

    /// Transfers collateral in and issues a quantity of BUs to the caller
    /// @param to The account to transfer collateral to
    /// @param BUs {qBU} The quantity of BUs to issue
    function issue(address to, uint256 BUs) external override {
        require(BUs > 0, "Cannot issue zero");
        require(_basket.size > 0, "Empty basket");

        uint256[] memory amounts = tokenAmounts(BUs);

        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.assets[i].erc20().safeTransferFrom(_msgSender(), address(this), amounts[i]);
        }

        basketUnits[to] += BUs;
        totalUnits += BUs;
        emit BUIssuance(to, _msgSender(), BUs);
    }

    /// Redeems a quantity of BUs and transfers collateral out
    /// @param to The account to transfer collateral to
    /// @param BUs {qBU} The quantity of BUs to redeem
    function redeem(address to, uint256 BUs) external override {
        require(BUs > 0, "Cannot redeem zero");
        require(BUs <= basketUnits[_msgSender()], "Not enough units");
        require(_basket.size > 0, "Empty basket");

        uint256[] memory amounts = tokenAmounts(BUs);

        basketUnits[_msgSender()] -= BUs;
        totalUnits -= BUs;

        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.assets[i].erc20().safeTransfer(to, amounts[i]);
        }
        emit BURedemption(to, _msgSender(), BUs);
    }

    /// Allows `spender` to spend `BUs` from the callers account
    /// @param spender The account that is able to spend the `BUs`
    /// @param BUs {qBU} The quantity of BUs that should be spendable
    function setAllowance(address spender, uint256 BUs) external override {
        _allowances[_msgSender()][spender] = BUs;
    }

    /// Pulls BUs over from one account to another (like `ERC20.transferFrom`), requiring allowance
    /// @param from The account to pull BUs from (must have set allowance)
    /// @param BUs {qBU} The quantity of BUs to pull
    function pullBUs(address from, uint256 BUs) external override {
        require(basketUnits[from] >= BUs, "not enough to transfer");
        require(_allowances[from][_msgSender()] >= BUs, "not enough allowance");
        _allowances[from][_msgSender()] -= BUs;
        basketUnits[from] -= BUs;
        basketUnits[_msgSender()] += BUs;
        emit BUTransfer(from, _msgSender(), BUs);
    }

    /// Claims all earned COMP/AAVE and sends it to the asset manager
    function claimAndSweepRewardsToManager() external override {
        require(address(main) != address(0), "main not set");

        // Claim
        main.comptroller().claimComp(address(this));
        for (uint256 i = 0; i < _basket.size; i++) {
            // Only aTokens need to be claimed at the asset level
            _basket.assets[i].claimRewards();
        }

        // Sweep
        IERC20 comp = main.compAsset().erc20();
        uint256 compBal = comp.balanceOf(address(this));
        if (compBal > 0) {
            comp.safeTransfer(address(main.manager()), compBal);
        }
        IERC20 aave = main.aaveAsset().erc20();
        uint256 aaveBal = aave.balanceOf(address(this));
        if (aaveBal > 0) {
            aave.safeTransfer(address(main.manager()), aaveBal);
        }
        emit ClaimRewards(compBal, aaveBal);
    }

    /// @param BUs {qBU}
    /// @return amounts {qTok} A list of token quantities required in order to issue `BUs`
    function tokenAmounts(uint256 BUs) public view override returns (uint256[] memory amounts) {
        amounts = new uint256[](_basket.size);
        for (uint256 i = 0; i < _basket.size; i++) {
            // {qTok} = {qTok/BU} * {qBU} / {qBU/BU}
            amounts[i] = toFix(BUs).divu(1e18).mulu(_basket.quantities[_basket.assets[i]]).toUint();
        }
    }

    /// @return {qTok/BU} The quantity of tokens of `asset` required per whole BU
    function quantity(IAsset asset) external view override returns (uint256) {
        return _basket.quantities[asset];
    }

    /// @return sum {attoUSD/BU} The attoUSD value of 1 BU if all fiatcoins hold peg
    function basketRate() external override returns (Fix sum) {
        for (uint256 i = 0; i < _basket.size; i++) {
            IAsset a = _basket.assets[i];

            // {attoUSD/BU} = {attoUSD/BU} + {attoUSD/qTok} * {qTok/BU}
            sum = sum.plus(a.rateUSD().mulu(_basket.quantities[a]));
        }
    }

    /// @return Whether the vault is made up only of collateral in `assets`
    function containsOnly(address[] memory assets) external view override returns (bool) {
        for (uint256 i = 0; i < _basket.size; i++) {
            bool found = false;
            for (uint256 j = 0; j < assets.length; j++) {
                if (address(_basket.assets[i]) == assets[j]) {
                    found = true;
                }
            }
            if (!found) {
                return false;
            }
        }
        return true;
    }

    /// @return {BU} The maximum number of BUs the caller can issue
    function maxIssuable(address issuer) external view override returns (uint256) {
        Fix min = FIX_MAX;
        for (uint256 i = 0; i < _basket.size; i++) {
            // {BU} = {qTok} / {qTok/BU}
            Fix BUs = toFix(_basket.assets[i].erc20().balanceOf(issuer)).divu(_basket.quantities[_basket.assets[i]]);
            if (BUs.lt(min)) {
                min = BUs;
            }
        }
        return min.toUint();
    }

    /// @return The asset at `index`
    function assetAt(uint256 index) external view override returns (IAsset) {
        return _basket.assets[index];
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

    function setMain(IMain main_) external onlyOwner {
        main = main_;
    }
}

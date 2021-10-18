// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IFaucet.sol";
import "./interfaces/IVault.sol";
import "./interfaces/ICollateral.sol";
import "./OracleP0.sol";

contract RTokenP0 is IRToken, ERC20, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant SCALE = 1e18;

    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingRatioScaled / _basketDilutionRatioScaled
    // <RToken> = b * <Basket Unit Vector>
    // #RTokens <= #BUs / b
    // #BUs = vault.basketUnits(address(this))

    uint256 internal _meltingRatioScaled = 1e18; // increases the base factor
    uint256 internal _basketDilutionRatioScaled = 1e18; // decreases the base factor

    uint256 public fScaled; // the fraction of revenue that goes to stakers
    uint256 public prevBasketFiatcoinRate; // the redemption value of the basket in fiatcoins last time f was updated

    uint256 public melted;
    uint256 public targetBUs;

    IVault public vault;
    IFaucet public faucet;
    Oracle public oracle;

    address public pauser;
    bool public paused;
    bool public inDefault;

    constructor(
        string memory name_,
        string memory symbol_,
        IVault vault_,
        IFaucet faucet_,
        Oracle oracle_
    ) ERC20(name_, symbol_) {
        vault = vault_;
        faucet = faucet_;
        oracle = oracle_;
        pauser = _msgSender();
        prevBasketFiatcoinRate = vault.basketFiatcoinRate();
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    modifier before() {
        faucet.drip();
        _melt();
        _diluteBasket();
        _;
    }

    function act() external override notPaused before {
        // Closed form computation of state
        // Launch any auctions

        // 1. Trading mechanism
        // 2. Trading algorithm
    }

    function detectDefault() external override notPaused {
        // 1. Check fiatcoin redemption rates have not decreased since last time.
        // 2. Check oracle prices of fiatcoins for default
    }

    function issue(uint256 amount) external override notPaused before {
        require(amount > 0, "Cannot issue zero");
        uint256 BUs = _toBUs(amount);
        uint256[] memory tokenAmounts = vault.tokenAmounts(BUs);
        ICollateral c;

        for (uint16 i = 0; i < vault.basketSize(); i++) {
            c = ICollateral(vault.collateralAt(i));
            IERC20(c.erc20()).safeTransferFrom(_msgSender(), address(this), tokenAmounts[i]);
            IERC20(c.erc20()).safeApprove(address(vault), tokenAmounts[i]);
        }

        vault.issue(BUs);
        _mint(_msgSender(), amount);
        targetBUs += BUs;
    }

    function redeem(uint256 amount) external override notPaused before {
        require(amount > 0, "Cannot redeem zero");
        _burn(_msgSender(), amount);

        uint256 BUs = _toBUs(amount);
        vault.redeem(BUs);
        targetBUs -= BUs;

        uint256[] memory tokenAmounts = vault.tokenAmounts(BUs);
        ICollateral c;

        for (uint16 i = 0; i < vault.basketSize(); i++) {
            c = ICollateral(vault.collateralAt(i));
            IERC20(c.erc20()).safeTransfer(_msgSender(), tokenAmounts[i]);
        }
    }

    function pause() external override {
        require(_msgSender() == pauser, "only pauser");
        paused = true;
    }

    function unpause() external override {
        require(_msgSender() == pauser, "only pauser");
        paused = false;
    }

    function setPauser(address pauser_) external onlyOwner {
        pauser = pauser_;
    }

    function setVault(IVault vault) external onlyOwner {
        vault = vault;
    }

    function quoteIssue(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote issue zero");
        return vault.tokenAmounts(_toBUs(amount));
    }

    function quoteRedeem(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote redeem zero");
        return vault.tokenAmounts(_toBUs(amount));
    }

    function _toBUs(uint256 amount) internal view returns (uint256) {
        return (amount * _basketDilutionRatioScaled) / _meltingRatioScaled;
    }

    function _fromBUs(uint256 amount) internal view returns (uint256) {
        return (amount * _meltingRatioScaled) / _basketDilutionRatioScaled;
    }

    function _melt() internal {
        uint256 amount = balanceOf(address(this));
        _burn(address(this), amount);
        melted += amount;
        _meltingRatioScaled = SCALE * (totalSupply() + melted) / totalSupply();
    }

    function _diluteBasket() internal {
        uint256 current = vault.basketFiatcoinRate();
        _basketDilutionRatioScaled = SCALE + fScaled * (SCALE * current / prevBasketFiatcoinRate - SCALE);
    }
}

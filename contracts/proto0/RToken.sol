// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./VaultP0.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IVault.sol";

contract RToken is IRToken, ERC20, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant SCALE = 1e18;

    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingRatio / _basketDilutionRatio
    // <RToken> = b * <Basket Unit Vector>
    // #RTokens <= #BUs / b
    // #BUs = _vault.basketUnits(address(this))

    uint256 internal _meltingRatio; // increases the base factor
    uint256 internal _basketDilutionRatio; // decreases the base factor

    IVault public _vault;

    address public pauser;
    bool public paused;
    bool public inDefault;

    constructor(string memory name, string memory symbol, IVault vault) ERC20(name, symbol) {
        _vault = vault;
        pauser = _msgSender();
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    function act() external override notPaused {
        // Closed form computation of state
        // Launch any auctions
    }

    function detectDefault() external override notPaused {
        // Oracle readouts
        // Check for default
    }

    function issue(uint256 amount) external override notPaused {
        require(amount > 0, "Cannot issue zero");
        uint256 BUs = _toBUs(amount);
        uint256[] memory tokenAmounts = _vault.tokenAmounts(BUs);
        Token memory token;

        for (uint16 i = 0; i < _vault.basketSize(); i++) {
            token = _vault.tokenAt(i);
            IERC20(token.tokenAddress).safeTransferFrom(_msgSender(), address(this), tokenAmounts[i]);
            IERC20(token.tokenAddress).safeApprove(address(_vault), tokenAmounts[i]);
        }

        _vault.issue(BUs);
        _mint(_msgSender(), amount);
    }

    function redeem(uint256 amount) external override notPaused {
        require(amount > 0, "Cannot redeem zero");
        _burn(_msgSender(), amount);
        
        uint256 BUs = _toBUs(amount);
        _vault.redeem(BUs);

        uint256[] memory tokenAmounts = _vault.tokenAmounts(BUs);
        Token memory token;

        for (uint16 i = 0; i < _vault.basketSize(); i++) {
            token = _vault.tokenAt(i);
            IERC20(token.tokenAddress).safeTransfer(_msgSender(), tokenAmounts[i]);
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
        _vault = vault;
    }

    function quoteIssue(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote issue zero");
        return _vault.tokenAmounts(_toBUs(amount));
    }

    function quoteRedeem(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote redeem zero");
        return _vault.tokenAmounts(_toBUs(amount));
    }

    function _toBUs(uint256 amount) internal view returns (uint256) {
        return amount * _basketDilutionRatio / _meltingRatio;
    }

    function _fromBUs(uint256 amount) internal view returns (uint256) {
        return amount * _meltingRatio / _basketDilutionRatio;
    }
}

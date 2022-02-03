// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title RTokenP0
 * @notice An ERC20 with an elastic supply.
 */
contract RTokenP0 is Ownable, ERC20Permit, IRToken {
    using SafeERC20 for IERC20Metadata;
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    IMain public main;

    Fix public constant MIN_ISSUANCE_RATE = Fix.wrap(1e40); // {qRTok/block} 10k whole RTok

    // Slow Issuance
    SlowIssuance[] public issuances;

    constructor(
        IMain main_,
        string memory name_,
        string memory symbol_,
        address owner_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        main = main_;
        _transferOwnership(owner_);
    }

    // Process slow issuances:
    // - undoes any issuances that was started before the basket was last set
    // - enacts any other issuances that are fully vested
    function poke() public override {
        Fix currentBlock = toFix(block.number);
        bool backingIsSound = main.worstCollateralStatus() == CollateralStatus.SOUND;

        for (uint256 i = 0; i < issuances.length; i++) {
            SlowIssuance storage iss = issuances[i];
            if (iss.processed) continue;

            if (!backingIsSound || iss.blockStartedAt <= main.blockBasketLastChanged()) {
                // Rollback issuance i
                for (uint256 j = 0; j < iss.erc20s.length; j++) {
                    IERC20(iss.erc20s[j]).safeTransfer(iss.issuer, iss.deposits[j]);
                }
                iss.processed = true;
                emit IssuanceCanceled(i);
            } else if (iss.blockAvailableAt.lte(currentBlock)) {
                for (uint256 j = 0; j < iss.erc20s.length; j++) {
                    IERC20(iss.erc20s[j]).safeTransfer(address(main), iss.deposits[j]);
                }

                _mint(iss.issuer, iss.amount);
                iss.processed = true;
                emit IssuanceCompleted(i);
            }
        }
    }

    /// Begins the SlowIssuance accounting process
    /// @param issuer The account issuing the RToken
    /// @param amount {qRTok}
    /// @param deposits {qTok}
    function beginSlowIssuance(
        address issuer,
        uint256 amount,
        address[] memory erc20s,
        uint256[] memory deposits
    ) external override {
        require(_msgSender() == address(main), "only main");
        require(erc20s.length == deposits.length, "must be same length");

        // Here we assume Main has already sent in the collateral
        SlowIssuance memory iss = SlowIssuance({
            blockStartedAt: block.number,
            amount: amount,
            erc20s: erc20s,
            deposits: deposits,
            issuer: issuer,
            blockAvailableAt: nextIssuanceBlockAvailable(amount),
            processed: false
        });
        issuances.push(iss);

        emit IssuanceStarted(
            issuances.length - 1,
            iss.issuer,
            iss.amount,
            iss.erc20s,
            iss.deposits,
            iss.blockAvailableAt
        );
    }

    /// Mints a quantity of RToken to the `recipient`, only callable by AssetManager
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qTok} The amount to be minted
    /// @return true
    function mint(address recipient, uint256 amount) external virtual override returns (bool) {
        require(_msgSender() == address(main), "only main");
        _mint(recipient, amount);
        return true;
    }

    /// Burns a quantity of RToken from an account, only callable by AssetManager or `from`
    /// @param from The account from which RToken should be burned
    /// @param amount {qTok} The amount to be burned
    /// @return true
    function burn(address from, uint256 amount) external virtual override returns (bool) {
        require(_msgSender() == from || _msgSender() == address(main), "only self or main");
        _burn(from, amount);
        return true;
    }

    function setMain(IMain main_) external virtual override onlyOwner {
        emit MainSet(main, main_);
        main = main_;
    }

    // ==== Private ====

    // Returns the future block number at which an issuance for *amount* now can complete
    function nextIssuanceBlockAvailable(uint256 amount) private view returns (Fix) {
        Fix perBlock = fixMax(MIN_ISSUANCE_RATE, main.issuanceRate().mulu(totalSupply()));
        Fix blockStart = toFix(block.number);
        if (
            issuances.length > 0 && issuances[issuances.length - 1].blockAvailableAt.gt(blockStart)
        ) {
            blockStart = issuances[issuances.length - 1].blockAvailableAt;
        }
        return blockStart.plus(divFix(amount, perBlock));
    }
}

// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IFacadeRead.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IStRSR.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/BasketHandler.sol";
import "contracts/p1/BackingManager.sol";
import "contracts/p1/Furnace.sol";
import "contracts/p1/RToken.sol";
import "contracts/p1/RevenueTrader.sol";
import "contracts/p1/StRSRVotes.sol";

/**
 * @title Facade
 * @notice A UX-friendly layer for reading out the state of an RToken in summary views.
 * @custom:static-call - Use ethers callStatic() to get result after update; do not execute
 */
contract FacadeRead is IFacadeRead {
    using FixLib for uint192;

    // === Static Calls ===

    /// @return {qRTok} How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(IRToken rToken, address account) external returns (uint256) {
        IMain main = rToken.main();
        main.poke();
        // {BU}

        uint192 held = main.basketHandler().basketsHeldBy(account);
        uint192 needed = rToken.basketsNeeded();

        int8 decimals = int8(rToken.decimals());

        // return {qRTok} = {BU} * {(1 RToken) qRTok/BU)}
        if (needed.eq(FIX_ZERO)) return held.shiftl_toUint(decimals);

        uint192 totalSupply = shiftl_toFix(rToken.totalSupply(), -decimals); // {rTok}

        // {qRTok} = {BU} * {rTok} / {BU} * {qRTok/rTok}
        return held.mulDiv(totalSupply, needed).shiftl_toUint(decimals);
    }

    /// @custom:static-call
    function issue(IRToken rToken, uint256 amount)
        public
        returns (address[] memory tokens, uint256[] memory deposits)
    {
        IMain main = rToken.main();
        main.poke();
        IRToken rTok = rToken;
        IBasketHandler bh = main.basketHandler();

        // Compute # of baskets to create `amount` qRTok
        uint192 baskets = (rTok.totalSupply() > 0) // {BU}
            ? rTok.basketsNeeded().muluDivu(amount, rTok.totalSupply()) // {BU * qRTok / qRTok}
            : shiftl_toFix(amount, -int8(rTok.decimals())); // {qRTok / qRTok}

        (tokens, deposits) = bh.quote(baskets, CEIL);
    }

    /// @return erc20s The ERC20 addresses in the current basket
    /// @return uoaShares {1} The proportion of the basket associated with each ERC20
    /// @return targets The bytes32 representations of the target unit associated with each ERC20
    /// @custom:static-call
    function basketBreakdown(RTokenP1 rToken)
        external
        returns (
            address[] memory erc20s,
            uint192[] memory uoaShares,
            bytes32[] memory targets
        )
    {
        uint256[] memory deposits;
        IAssetRegistry assetRegistry = rToken.main().assetRegistry();
        IBasketHandler basketHandler = rToken.main().basketHandler();

        // (erc20s, deposits) = issue(rToken, FIX_ONE);

        // solhint-disable-next-line no-empty-blocks
        try rToken.main().furnace().melt() {} catch {}

        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        uint192 amtBaskets = uint192(
            rToken.totalSupply() > 0
                ? mulDiv256(rToken.basketsNeeded(), FIX_ONE, rToken.totalSupply())
                : FIX_ONE
        );

        (erc20s, deposits) = basketHandler.quote(amtBaskets, CEIL);

        // Calculate uoaAmts
        uint192 uoaSum;
        uint192[] memory uoaAmts = new uint192[](erc20s.length);
        targets = new bytes32[](erc20s.length);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            ICollateral coll = assetRegistry.toColl(IERC20(erc20s[i]));
            int8 decimals = int8(IERC20Metadata(erc20s[i]).decimals());

            // {UoA} = {qTok} * {tok/qTok} * {UoA/tok}
            uoaAmts[i] = shiftl_toFix(deposits[i], -decimals).mul(coll.strictPrice());
            uoaSum += uoaAmts[i];
            targets[i] = coll.targetName();
        }

        uoaShares = new uint192[](erc20s.length);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            uoaShares[i] = uoaAmts[i].div(uoaSum);
        }
    }

    // === Views ===

    /// @param account The account for the query
    /// @return issuances All the pending RToken issuances for an account
    /// @custom:view
    function pendingIssuances(RTokenP1 rToken, address account)
        external
        view
        returns (Pending[] memory issuances)
    {
        (, uint256 left, uint256 right) = rToken.issueQueues(account);
        issuances = new Pending[](right - left);
        for (uint256 i = 0; i < right - left; i++) {
            RTokenP1.IssueItem memory issueItem = rToken.issueItem(account, i + left);
            uint256 diff = i + left == 0
                ? issueItem.amtRToken
                : issueItem.amtRToken - rToken.issueItem(account, i + left - 1).amtRToken;
            issuances[i] = Pending(i + left, issueItem.when, diff);
        }
    }

    /// @param account The account for the query
    /// @return unstakings All the pending RToken issuances for an account
    /// @custom:view
    function pendingUnstakings(RTokenP1 rToken, address account)
        external
        view
        returns (Pending[] memory unstakings)
    {
        StRSRP1Votes stRSR = StRSRP1Votes(address(rToken.main().stRSR()));
        uint256 era = stRSR.currentEra();
        uint256 left = stRSR.firstRemainingDraft(era, account);
        uint256 right = stRSR.draftQueueLen(era, account);

        unstakings = new Pending[](right - left);
        for (uint256 i = 0; i < right - left; i++) {
            (uint192 drafts, uint64 availableAt) = stRSR.draftQueues(era, account, i + left);

            uint192 diff = drafts;
            if (i + left > 0) {
                (uint192 prevDrafts, ) = stRSR.draftQueues(era, account, i + left - 1);
                diff = drafts - prevDrafts;
            }

            unstakings[i] = Pending(i + left, availableAt, diff);
        }
    }

    /// @return A non-inclusive ending index
    /// @custom:view
    function endIdForVest(RTokenP1 rToken, address account) external view returns (uint256) {
        (uint256 queueLeft, uint256 queueRight) = rToken.queueBounds(account);
        uint256 blockNumber = FIX_ONE_256 * block.number; // D18{block} = D18{1} * {block}

        RTokenP1.IssueItem memory item;

        // Handle common edge cases in O(1)
        if (queueLeft == queueRight) return queueLeft;

        item = rToken.issueItem(account, queueLeft);
        if (blockNumber < item.when) return queueLeft;

        item = rToken.issueItem(account, queueRight - 1);
        if (item.when <= blockNumber) return queueRight;

        // find left and right (using binary search where always left <= right) such that:
        //     left == right - 1
        //     queue[left].when <= block.timestamp
        //     right == queueRight  or  block.timestamp < queue[right].when
        uint256 left = queueLeft;
        uint256 right = queueRight;
        while (left < right - 1) {
            uint256 test = (left + right) / 2;
            // In this condition: D18{block} < D18{block}
            item = rToken.issueItem(account, test);
            if (item.when <= blockNumber) left = test;
            else right = test;
        }
        return right;
    }

    /// @return tokens The addresses of the ERC20s backing the RToken
    function basketTokens(IRToken rToken) external view returns (address[] memory tokens) {
        IMain main = rToken.main();
        (tokens, ) = main.basketHandler().quote(FIX_ONE, CEIL);
    }

    /// @return stTokenAddress The address of the corresponding stToken for the rToken
    function stToken(IRToken rToken) external view returns (IStRSR stTokenAddress) {
        IMain main = rToken.main();
        stTokenAddress = main.stRSR();
    }

    /// @return backing The worst-case collaterazation % the protocol will have after done trading
    /// @return insurance The insurance value relative to the fully-backed value
    function backingOverview(IRToken rToken)
        external
        view
        returns (uint192 backing, uint192 insurance)
    {
        uint256 supply = rToken.totalSupply();
        if (supply == 0) return (0, 0);

        (, uint192 basketPrice) = rToken.main().basketHandler().price(false);

        // {UoA} = {BU} * {UoA/BU}
        uint192 uoaNeeded = rToken.basketsNeeded().mul(basketPrice);

        // Useful abbreviations
        IAssetRegistry assetRegistry = rToken.main().assetRegistry();
        address backingMgr = address(rToken.main().backingManager());
        IERC20 rsr = rToken.main().rsr();

        // Compute backing
        {
            IERC20[] memory erc20s = assetRegistry.erc20s();

            // Bound each withdrawal by the prorata share, in case we're currently under-capitalized
            uint192 uoaHeld;
            for (uint256 i = 0; i < erc20s.length; i++) {
                if (erc20s[i] == rsr) continue;

                IAsset asset = assetRegistry.toAsset(IERC20(erc20s[i]));

                // {UoA} = {tok} * {UoA/tok}
                uint192 uoa = asset.bal(backingMgr).mul(asset.strictPrice());
                uoaHeld = uoaHeld.plus(uoa);
            }

            // {1} = {UoA} / {UoA}
            backing = uoaHeld.div(uoaNeeded);
        }

        // Compute insurance
        {
            IAsset rsrAsset = assetRegistry.toAsset(rsr);

            // {tok} = {tok} + {tok}
            uint192 rsrBal = rsrAsset.bal(backingMgr).plus(
                rsrAsset.bal(address(rToken.main().stRSR()))
            );

            // {UoA} = {tok} * {UoA/tok}
            uint192 rsrUoA = rsrBal.mul(rsrAsset.strictPrice());

            // {1} = {UoA} / {UoA}
            insurance = rsrUoA.div(uoaNeeded);
        }
    }

    /// @return {UoA/tok} The price of the RToken as given by the relevant RTokenAsset
    function price(IRToken rToken) external view returns (uint192) {
        return rToken.main().assetRegistry().toAsset(IERC20(address(rToken))).strictPrice();
    }
}

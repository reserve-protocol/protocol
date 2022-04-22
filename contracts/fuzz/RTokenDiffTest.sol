// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/p0/RToken.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/p1/RToken.sol";
import "contracts/interfaces/IBackingManager.sol";
import "contracts/interfaces/IBasketHandler.sol";
import "contracts/plugins/mocks/ERC20Mock.sol";
import "contracts/fuzz/Mocks.sol";
import "contracts/fuzz/Utils.sol";

/* TODO: Here's a few of the many ways that this test could be improved:

   - Decorate basically everything with events for clues about test failures

   - Have the MockBasketHandler and MockBackingManager save an "event" log, representing the
     state-change events that they've been issued, so that we can ensure the equivalence of the
     function call sequence that each RToken emits

   - Get these mocks to be more active, so they exercise more of the RToken space.
       - In particular, make the referesher functions do more of what they're intended to do
       - Have the mock contracts act wildly, possibly represented by more actions from the
         RTokenDiffTest contract, to mock out changes that might effect the RToken (but that the
         RToken probably doesn't model directly)

   - Change the mock basket model from "token A" to "switches between token A and token B" or use
       - Or something yet more ambitious? This could be practically anything we can drive from
         random actions.

   - It *might* be that these mocked-out component models are really useful for other fuzz tests too
 */

contract MockBackingManager is IBackingManager, ComponentMock {
    function init(
        IMain,
        uint256,
        int192,
        int192,
        int192
    ) external {}

    function grantAllowances() external {}

    function manageFunds() external {}

    /// Settle any auctions that can be settled
    function settleTrades() external virtual override {}

    function claimAndSweepRewards() external virtual override {}

    /// @return {%} The maximum trade slippage acceptable
    function maxTradeSlippage() external view virtual override returns (int192) {
        return 1e16;
    }

    /// @return {UoA} The smallest amount of value worth trading
    function dustAmount() external view virtual override returns (int192) {
        return 2e20;
    }
}

contract MockBasketHandler is IBasketHandler, ComponentMock {
    using FixLib for int192;
    /* The mock basket we're running with, here, is always either 100% A or 100% B.
     * Each is always assumed to have a price of 1 UoA.
     * We can (and maybe should) build something with wider behavior
     */

    // Is the basket 100% A (instead of 100% B?)
    bool public modeA = true;
    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public nonce = 0;
    uint256 public timestamp;

    constructor(IERC20 tokenA_, IERC20 tokenB_) {
        tokenA = tokenA_;
        tokenB = tokenB_;
        timestamp = block.timestamp;
    }

    function init(IMain) external {}

    function token() private view returns (IERC20) {
        return modeA ? tokenA : tokenB;
    }

    /// Set the prime basket
    function setPrimeBasket(IERC20[] memory, int192[] memory) external {}

    /// Set the backup configuration for a given target
    function setBackupConfig(
        bytes32,
        uint256,
        IERC20[] calldata
    ) external {}

    /// Try to ensure the current basket is valid, causing underlying updates
    function ensureBasket() external {}

    /// Governance-controlled setter to cause a basket switch explicitly
    function switchBasket() external {
        // TODO: modeA = !modeA, and we do all the needed trades and handle capitalization
        ++nonce;
        timestamp = block.timestamp;
    }

    /// @return If the BackingManager has sufficient collateral to redeem the entire RToken supply
    function fullyCapitalized() external pure returns (bool) {
        return true;
    }

    /// @return status The worst CollateralStatus of all collateral in the basket
    function status() external pure returns (CollateralStatus) {
        return CollateralStatus.SOUND;
    }

    /// @return {tok/BU} The whole token quantity of token in the reference basket
    function quantity(IERC20 erc20) external view returns (int192) {
        return token() == erc20 ? FIX_ONE : FIX_ZERO;
    }

    /// @param amount {BU}
    /// @return erc20s The addresses of the ERC20 tokens in the reference basket
    /// @return quantities {qTok} The quantity of each ERC20 token to issue `amount` baskets
    function quote(int192 amount, RoundingMode rounding)
        external
        view
        returns (address[] memory erc20s, uint256[] memory quantities)
    {
        erc20s = new address[](1);
        erc20s[0] = modeA ? address(tokenA) : address(tokenB);
        quantities = new uint256[](1);
        quantities[0] = amount.shiftl(18).toUint(rounding);
    }

    /// @return baskets {BU} The quantity of complete baskets at an address. A balance for BUs
    function basketsHeldBy(address acct) external view returns (int192 baskets) {
        int8 decimals = int8(IERC20Metadata(address(token())).decimals());
        baskets = shiftl_toFix(token().balanceOf(acct), -decimals);
    }

    /// @return p {UoA/BU} The protocol's best guess at what a BU would be priced at in UoA
    function price() external pure returns (int192 p) {
        return FIX_ONE;
    }

    /// @return nonce_ The basket nonce, a monotonically increasing unique identifier
    /// @return timestamp_ The timestamp at which the basket was last set
    function lastSet() external view returns (uint256 nonce_, uint256 timestamp_) {
        nonce_ = nonce;
        timestamp_ = timestamp;
    }
}

contract RTokenTestSystem is MainMock {
    using FixLib for int192;

    ERC20Mock public baseA;
    ERC20Mock public baseB;

    constructor(IRToken rToken_) {
        DeploymentParams memory params = defaultParams();
        Components memory components;

        baseA = new ERC20Mock("Base Token A", "A$");
        baseB = new ERC20Mock("Base Token B", "B$");
        for (uint256 i = 0; i < USERS.length; i++) {
            baseA.mint(USERS[i], 1e24);
            baseB.mint(USERS[i], 1e24);
        }

        init(components, IERC20(address(0)));

        basketHandler = new MockBasketHandler(baseA, baseB);
        basketHandler.init(this);

        backingManager = new MockBackingManager();
        backingManager.init(
            this,
            params.tradingDelay,
            params.backingBuffer,
            params.maxTradeSlippage,
            params.dustAmount
        );

        rToken = rToken_;
        rToken.init(this, "RToken", "RTK", "rtoken://1", params.issuanceRate);
    }

    function poke() public virtual override {
        basketHandler.ensureBasket(); // maaaaaaybe
        backingManager.settleTrades(); // maaaaaybe?
        // sometimes tokens
    }
}

contract RTokenP0Test is RTokenP0 {
    function _msgSender() internal view virtual override returns (address) {
        return MainMock(address(main)).sender();
    }
}

contract RTokenP1Test is RTokenP1 {
    function _msgSender() internal view virtual override returns (address) {
        return MainMock(address(main)).sender();
    }
}

contract RTokenDiffTest {
    using FixLib for int192;
    address[] public USERS = [address(0x10000), address(0x20000), address(0x30000)];

    RTokenTestSystem public p0;
    RTokenTestSystem public p1;

    modifier fromSender() {
        p0.setSender(msg.sender);
        p1.setSender(msg.sender);
        _;
        p0.setSender(address(0));
        p1.setSender(address(0));
    }

    modifier fromBackingMgr() {
        p0.setSender(address(p0.backingManager()));
        p1.setSender(address(p1.backingManager()));
        _;
        p0.setSender(address(0));
        p1.setSender(address(0));
    }

    constructor() {
        p0 = new RTokenTestSystem(new RTokenP0Test());
        p1 = new RTokenTestSystem(new RTokenP1Test());
    }

    // Actions and state modifiers

    // ==== user actions, performed by 0x[123]0000. Melt
    function issue(uint256 amount) external fromSender {
        amount %= 1e36;

        p0.rToken().issue(amount);
        p1.rToken().issue(amount);
    }

    function cancel(uint256 endId, bool e) external fromSender {
        p0.rToken().cancel(endId, e);
        p1.rToken().cancel(endId, e);
    }

    function vest(address acct, uint256 endId) external fromSender {
        p0.rToken().vest(acct, endId);
        p1.rToken().vest(acct, endId);
    }

    // TODO: Add "cancel" and "vest" variations that are likely to succeed too
    // i.e, ones that have valid endIDs
    function redeem(uint256 amount) external fromSender {
        amount %= 1e36;

        p0.rToken().redeem(amount);
        p1.rToken().redeem(amount);
    }

    function melt(uint256 amount) external fromSender {
        amount %= 1e36;
        p0.rToken().melt(amount);
        p1.rToken().melt(amount);
    }

    function mint(address recipient, uint256 amount) external fromBackingMgr {
        amount %= 1e36;
        recipient = address((uint160(recipient) % 3) * 0x10000); // mint only to USERS
        p0.rToken().mint(recipient, amount);
        p1.rToken().mint(recipient, amount);
    }

    function setBasketsNeeded(int192 basketsNeeded) external fromBackingMgr {
        basketsNeeded %= 1e36;
        p0.rToken().setBasketsNeeded(basketsNeeded);
        p1.rToken().setBasketsNeeded(basketsNeeded);
    }

    // Auth on these is that the caller needs to be main.owner. That... should be this contract?
    function setIssuanceRate(int192 val) external {
        val %= 1e24;
        assert(p0.owner() == address(this)); // hope but verify
        assert(p1.owner() == address(this));
        RTokenP0(address(p0.rToken())).setIssuanceRate(val);
        RTokenP1(address(p1.rToken())).setIssuanceRate(val);
    }

    // TODO: changes to MockERC20 balances

    // Invariant: the observable rtoken prices are equal
    function echidna_prices_equal() external view returns (bool) {
        return p0.rToken().price() == p1.rToken().price();
    }

    function echidna_vesting_ids_equal() external view returns (bool) {
        return
            p0.rToken().endIdForVest(USERS[0]) == p1.rToken().endIdForVest(USERS[0]) &&
            p0.rToken().endIdForVest(USERS[1]) == p1.rToken().endIdForVest(USERS[1]) &&
            p0.rToken().endIdForVest(USERS[2]) == p1.rToken().endIdForVest(USERS[2]);
    }

    function echidna_baskets_needed_equal() external view returns (bool) {
        return p0.rToken().basketsNeeded() == p1.rToken().basketsNeeded();
    }

    function all_balances_equal(address acct0, address acct1) internal view returns (bool) {
        return
            p0.baseA().balanceOf(acct0) == p1.baseA().balanceOf(acct1) &&
            p0.baseB().balanceOf(acct0) == p1.baseB().balanceOf(acct1) &&
            p0.rToken().balanceOf(acct0) == p1.rToken().balanceOf(acct1);
    }

    function echidna_user_balances_equal() external view returns (bool equal) {
        equal =
            all_balances_equal(address(p0.backingManager()), address(p1.backingManager())) &&
            all_balances_equal(address(p0.basketHandler()), address(p1.basketHandler())) &&
            all_balances_equal(address(p0), address(p1));
        for (uint256 i = 0; i < USERS.length; i++) {
            equal = equal && all_balances_equal(USERS[i], USERS[i]);
        }
    }
}

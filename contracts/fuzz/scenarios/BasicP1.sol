// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Strings.sol";

import "contracts/fuzz/IFuzz.sol";
import "contracts/fuzz/CollateralMock.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/TradeMock.sol";
import "contracts/fuzz/Utils.sol";

import "contracts/fuzz/FuzzP1.sol";

contract BasicP1Scenario {
    MainP1Fuzz public main;

    PriceModel internal volatile =
        PriceModel({ kind: Kind.Walk, curr: 1e18, low: 0.5e18, high: 2e18 });
    PriceModel internal stable =
        PriceModel({ kind: Kind.Band, curr: 1e18, low: 0.995e18, high: 1.005e18 });
    PriceModel internal growing =
        PriceModel({ kind: Kind.Walk, curr: 1e18, low: 1e18, high: 1.1e18 });
    PriceModel internal justOne = PriceModel({ kind: Kind.Constant, curr: 1e18, low: 0, high: 0 });

    IERC20[] public collateralTokens;
    IERC20[] public backupTokens;

    // Once constructed, everything is set up for random echidna runs to happen:
    // - main and its components are up
    // - standard tokens, and their Assets and Collateral, exist
    // - standard basket is configured
    // - at least one user has plenty of starting tokens
    constructor() {
        main = new MainP1Fuzz();

        // Have components believe that owner is calling them during init.
        main.setSender(address(this));

        main.initFuzz(defaultParams(), defaultFreezeDuration(), new MarketMock(IMain(main)));

        uint192 maxTradeVolume = 1e48;

        // Create three "standard" collateral tokens
        for (uint256 i = 0; i < 3; i++) {
            string memory num = Strings.toString(i);
            ERC20Mock token = new ERC20Mock(concat("Collateral ", num), concat("C", num));
            main.addToken(token);

            main.assetRegistry().register(
                new CollateralMock(
                    IERC20Metadata(address(token)),
                    maxTradeVolume,
                    0,
                    0,
                    IERC20Metadata(address(0)),
                    bytes32("USD"),
                    growing,
                    stable,
                    justOne,
                    stable
                )
            );
            collateralTokens.push(IERC20(token));
        }

        // Create three "standard" backup USD tokens
        for (uint256 i = 0; i < 3; i++) {
            string memory num = Strings.toString(i);
            ERC20Mock token = new ERC20Mock(concat("Stable USD ", num), concat("USD", num));
            main.addToken(token);

            main.assetRegistry().register(
                new CollateralMock(
                    IERC20Metadata(address(token)),
                    maxTradeVolume,
                    0,
                    0,
                    IERC20Metadata(address(0)),
                    bytes32("USD"),
                    justOne,
                    stable,
                    justOne,
                    justOne
                )
            );
            backupTokens.push(IERC20(token));
        }

        // Configure basket
        uint192[] memory wts = new uint192[](3);
        wts[0] = 0.5e18;
        wts[1] = 0.3e18;
        wts[2] = 0.2e18;
        main.basketHandler().setPrimeBasket(collateralTokens, wts);
        main.basketHandler().setBackupConfig(bytes32("USD"), 3, backupTokens);
        main.basketHandler().refreshBasket();

        // Add a few users and give them initial tokens
        for (uint256 u = 1; u <= 3; u++) {
            address user = address(uint160(u * 0x10000));
            main.addUser(user);
            ERC20Mock(address(main.rsr())).mint(user, 1e24);
            for (uint256 t = 0; t < main.numTokens(); t++) {
                ERC20Mock(address(main.tokens(t))).mint(user, 1e24);
            }
        }

        // Complete deployment by unfreezing
        main.assetRegistry().refresh();
        main.unfreeze();

        main.setSender(address(0));
    }

    // function _setupTokens internal virtual

    // ==== tiny, stupid-simple example of all this ====

    function startIssue() public {
        address alice = main.users(0);
        ERC20Mock(address(main.tokens(0))).adminApprove(alice, address(main.rToken()), 1e24);
        ERC20Mock(address(main.tokens(1))).adminApprove(alice, address(main.rToken()), 1e24);
        ERC20Mock(address(main.tokens(2))).adminApprove(alice, address(main.rToken()), 1e24);

        main.setSender(alice);
        main.rToken().issue(1e24);
        main.setSender(address(0));
    }

    function finishIssue() public {
        main.rToken().vest(main.users(0), 1);
    }

    function redeem() public {
        main.setSender(main.users(0));

        main.backingManager().grantRTokenAllowance(main.tokens(0));
        main.backingManager().grantRTokenAllowance(main.tokens(1));
        main.backingManager().grantRTokenAllowance(main.tokens(2));
        main.rToken().redeem(1e24);

        main.setSender(address(0));
    }
}

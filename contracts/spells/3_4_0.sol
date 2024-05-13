// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "../interfaces/IDeployer.sol";
import "../interfaces/IMain.sol";

// interface avoids needing to know about P1 contracts
interface ICachedComponent {
    function cacheComponents() external;
}

/**
 * The upgrade contract for the 3.4.0 release. Each spell can only be cast once per msg.sender.
 *
 * Before spell 1 this contract must be admin of the timelock and owner of Main.
 *
 * Before spell 2 this contract must be owner of Main. It does not need to be admin of timelock.
 * WARNING: Only cast spell 2 after all balances have been fully processed for non-backing assets.
 *          That means any collateral assets no longer in the basket, and all non-collateral assets
 *          More specifically: All non-backing assets should have a balance under minTradeVolume.
 *
 *
 *
 * Only works on Mainnet and Base. Only supports RTokens listed on the Register as of May 1, 2024
 */
contract Upgrade3_4_0 {
    bytes32 constant ALEXIOS_HASH = keccak256(abi.encodePacked("Governor Alexios"));
    bytes32 constant ANASTASIUS_HASH = keccak256(abi.encodePacked("Governor Anastasius"));

    // Main
    bytes32 constant MAIN_OWNER_ROLE = bytes32("OWNER");

    // Timelock
    bytes32 constant TIMELOCK_ADMIN_ROLE = keccak256("TIMELOCK_ADMIN_ROLE");
    bytes32 constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

    // ======================================================================================

    // 3.4.0 Assets (mainnet)
    IAsset[51] MAINNET_ASSETS = [
        IAsset(0x591529f039Ba48C3bEAc5090e30ceDDcb41D0EaA), // RSR
        IAsset(0xF4493581D52671a9E04d693a68ccc61853bceEaE), // stkAAVE
        IAsset(0x63eDdF26Bc65eDa1D1c0147ce8E23c09BE963596), // COMP
        IAsset(0xc18bF46F178F7e90b9CD8b7A8b00Af026D5ce3D3), // CRV
        IAsset(0x7ef93b20C10E6662931b32Dd9D4b85861eB2E4b8), // CVX
        IAsset(0xEc375F2984D21D5ddb0D82767FD8a9C4CE8Eec2F), // DAI
        IAsset(0x442f8fc98e3cc6B3d49a66f9858Ac9B6e70Dad3e), // USDC
        IAsset(0xe7Dcd101A027Ec34860ECb634a2797d0D2dc4d8b), // USDT
        IAsset(0x4C0B21Acb267f1fAE4aeFA977A26c4a63C9B35e6), // USDP
        IAsset(0x97bb4a995b98b1BfF99046b3c518276f78fA5250), // BUSD
        IAsset(0x9ca9A9cdcE9E943608c945E7001dC89EB163991E), // aDAI
        IAsset(0xc4240D22FFa144E2712aACF3E2cC302af0339ED0), // aUSDC
        IAsset(0x8d753659D4E4e4b4601c7F01Dc1c920cA538E333), // aUSDT
        IAsset(0x01F9A6bf339cff820cA503A56FD3705AE35c27F7), // aBUSD
        IAsset(0xda5cc207CCefD116fF167a8ABEBBd52bD67C958E), // aUSDP
        IAsset(0x337E418b880bDA5860e05D632CF039B7751B907B), // cDAI
        IAsset(0x043be931D9C4422e1cFeA528e19818dcDfdE9Ebc), // cUSDC
        IAsset(0x5ceadb6606C5D82FcCd3f9b312C018fE1f8aa6dA), // cUSDT
        IAsset(0xa0c02De8FfBb9759b9beBA5e29C82112688A0Ff4), // cUSDP
        IAsset(0xC0f89AFcb6F1c4E943aA61FFcdFc41fDcB7D84DD), // cWBTC
        IAsset(0x4d3A8507a8eb9036895efdD1a462210CE58DE4ad), // cETH
        IAsset(0x832D65735E541c0404a58B741bEF5652c2B7D0Db), // WBTC
        IAsset(0xADDca344c92Be84A053C5CBE8e067460767FB816), // WETH
        IAsset(0xb7049ee9F533D32C9434101f0645E6Ea5DFe2cdb), // wstETH
        IAsset(0x987f5e0f845D46262893e680b652D8aAF1B5bCc0), // rETH
        IAsset(0xB58D95003Af73CF76Ce349103726a51D4Ec8af17), // fUSDC
        IAsset(0xD5254b740FbEF6AAcD674936ea7Fb9f4053781aF), // fUSDT
        IAsset(0xA0a620B94446a7DC8952ECf252FcC495eeC65873), // fDAI
        IAsset(0xFd9c32198D3cf3ad3b165918FD78De3654cb22eA), // fFRAX
        IAsset(0x33Ba1BC07b0fafb4BBC1520B330081b91ca6bdf0), // cUSDCv3
        IAsset(0x8E5ADdC553962DAcdF48106B6218AC93DA9617b2), // cvx3Pool
        IAsset(0x5315Fbe0CEB299F53aE375f65fd9376767C8224c), // cvxPayPool
        IAsset(0xE529B59C1764d6E5a274099Eb660DD9e130A5481), // cvxeUSDFRAXBP
        IAsset(0x3d21f841C0Fb125176C1DBDF0DE196b071323A75), // crvMIM3Pool
        IAsset(0xc4a5Fb266E8081D605D87f0b1290F54B0a5Dc221), // cvxETHPlusETH
        IAsset(0x945b0ad788dD6dB3864AB23876C68C1bf000d237), // crveUSDFRAXBP
        IAsset(0x692cf8CE08d03eF1f8C3dCa82F67935fa9417B62), // crvMIM3Pool
        IAsset(0xf59a7987EDd5380cbAb30c37D1c808686f9b67B9), // crv3Pool
        IAsset(0x62a9DDC6FF6077E823690118eCc935d16A8de47e), // sDAI
        // Morph-aave maUSDT/maUSDC/maDAI/maWBTC/maWETH/maStETH collateral excluded

        IAsset(0x1573416df7095F698e37A954D9e951868E526650), // yvCurveUSDCcrvUSD
        IAsset(0xb3A3552Cc52411dFF6D520C6F725E6F9e11001EF), // yvCurveUSDTcrvUSD
        IAsset(0x0b7DcCBceA6f985301506D575E2661bf858CdEcC), // sFRAX
        IAsset(0x00F820794Bda3fb01E5f159ee1fF7c8409fca5AB), // saEthUSDC
        IAsset(0x58a41c87f8C65cf21f961b570540b176e408Cf2E), // saEthPyUSD
        IAsset(0x01355C7439982c57cF89CA9785d211806f866224), // bbUSDT
        IAsset(0x565CBc99EE04667581c7f3459561fCaf1CF68602), // steakUSDC
        IAsset(0x23f06D5Fe858B18CD064A5D95054e8ae8536094a), // steakPYUSD
        IAsset(0xa0a6C06e45437d4Ae1D778AaeB4605AC2B62A870), // Re7WETH
        IAsset(0x9Fc0F31e2D26C437461a9eEBfe858d17e2611Ea5), // cvxCrvUSDUSDC
        IAsset(0x69c6597690B8Df61D15F201519C03725bdec40c1), // cvxCrvUSDUSDT
        IAsset(0x4c891fCa6319d492866672E3D2AfdAAA5bDcfF67) // sfrxETH
    ];

    // 3.4.0 Assets (base)
    IAsset[11] BASE_ASSETS = [
        IAsset(0x02062c16c28A169D1f2F5EfA7eEDc42c3311ec23), // RSR
        IAsset(0xB8794Fb1CCd62bFe631293163F4A3fC2d22e37e0), // COMP
        IAsset(0xEE527CC63122732532d0f1ad33Ec035D30f3050f), // STG
        IAsset(0x3E40840d0282C9F9cC7d17094b5239f87fcf18e5), // DAI
        IAsset(0xaa85216187F92a781D8F9Bcb40825E356ee2635a), // USDC
        IAsset(0xD126741474B0348D9B0F4911573d8f543c01C2c4), // USDbC
        IAsset(0x073BD162BBD05Cd2CF631B90D44239B8a367276e), // WETH
        IAsset(0x851B461a9744f4c9E996C03072cAB6f44Fa04d0D), // cbETH
        IAsset(0xC19f5d60e2Aca1174f3D5Fe189f0A69afaB76f50), // saBasUSDC
        IAsset(0xf7a9D27c3B60c78c6F6e2c2d6ED6E8B94b352461), // cUSDCv3
        IAsset(0x8b4374005291B8FCD14C4E947604b2FB3C660A73) // wstETH
    ];

    // =======================================================================================

    TestIDeployer public deployer;

    // RToken address => Anastasius Governor
    mapping(IRToken => IGovernor) public anastasiuses;

    // 3.4.0 ERC20 => 3.4.0 Asset
    mapping(IERC20 => IAsset) public assets; // ALL 3.4.0 assets

    // <3.4.0 ERC20 => 3.4.0 Asset
    mapping(IERC20 => IAsset) public rotations; // erc20 rotations

    // msg.sender => bool
    mapping(address => bool) public oneCast;
    mapping(address => bool) public twoCast;

    bool public mainnet; // !mainnet | base

    // =======================================================================================

    constructor(bool _mainnet) {
        // we have to pass-in `_mainnet` because chainid is not reliable during testing
        require(
            block.chainid == 1 || block.chainid == 31337 || block.chainid == 8453,
            "unsupported chain"
        );
        mainnet = _mainnet;

        // Set up `assets` array
        if (_mainnet) {
            // Set up `deployer`
            deployer = TestIDeployer(0x2204EC97D31E2C9eE62eaD9e6E2d5F7712D3f1bF);

            // Set up `anastasiuses`
            anastasiuses[IRToken(0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F)] = IGovernor(
                0xfa4Cc3c65c5CCe085Fc78dD262d00500cf7546CD // eUSD
            );
            anastasiuses[IRToken(0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8)] = IGovernor(
                0x991c13ff5e8bd3FFc59244A8cF13E0253C78d2bD // ETH+
            );
            anastasiuses[IRToken(0xaCdf0DBA4B9839b96221a8487e9ca660a48212be)] = IGovernor(
                0xb79434b4778E5C1930672053f4bE88D11BbD1f97 // hyUSD (mainnet)
            );
            anastasiuses[IRToken(0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b)] = IGovernor(
                0x6814F3489cbE3EB32b27508a75821073C85C12b7 // USDC+
            );
            anastasiuses[IRToken(0x0d86883FAf4FfD7aEb116390af37746F45b6f378)] = IGovernor(
                0x16a0F420426FD102a85A7CcA4BA25f6be1E98cFc // USD3
            );
            anastasiuses[IRToken(0x78da5799CF427Fee11e9996982F4150eCe7a99A7)] = IGovernor(
                0xE5D337258a1e8046fa87Ca687e3455Eb8b626e1F // rgUSD
            );

            // Set up `assets`
            for (uint256 i = 0; i < MAINNET_ASSETS.length; i++) {
                IERC20 erc20 = MAINNET_ASSETS[i].erc20();
                require(assets[erc20] == IAsset(address(0)), "duplicate asset");
                assets[erc20] = IAsset(MAINNET_ASSETS[i]);
            }

            // Set up wrapper `rotations`
            // <3.4.0 ERC20 => 3.4.0 Asset
            rotations[IERC20(0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9)] = IAsset(
                0x8d753659D4E4e4b4601c7F01Dc1c920cA538E333 // saUSDT
            );
            rotations[IERC20(0x60C384e226b120d93f3e0F4C502957b2B9C32B15)] = IAsset(
                0xc4240D22FFa144E2712aACF3E2cC302af0339ED0 // saUSDC
            );
            rotations[IERC20(0x8d6E0402A3E3aD1b43575b05905F9468447013cF)] = IAsset(
                0x58a41c87f8C65cf21f961b570540b176e408Cf2E // saEthPYUSD
            );
            rotations[IERC20(0x093cB4f405924a0C468b43209d5E466F1dd0aC7d)] = IAsset(
                0x00F820794Bda3fb01E5f159ee1fF7c8409fca5AB // saEthUSDC
            );
            rotations[IERC20(0xfBD1a538f5707C0D67a16ca4e3Fc711B80BD931A)] = IAsset(
                0x33Ba1BC07b0fafb4BBC1520B330081b91ca6bdf0 // wcUSDCv3
            );
            rotations[IERC20(0x093c07787920eB34A0A0c7a09823510725Aee4Af)] = IAsset(
                0x33Ba1BC07b0fafb4BBC1520B330081b91ca6bdf0 // wcUSDCv3
            );
            rotations[IERC20(0x7e1e077b289c0153b5ceAD9F264d66215341c9Ab)] = IAsset(
                0x33Ba1BC07b0fafb4BBC1520B330081b91ca6bdf0 // wcUSDCv3
            );
            rotations[IERC20(0x8e33D5aC344f9F2fc1f2670D45194C280d4fBcF1)] = IAsset(
                0xE529B59C1764d6E5a274099Eb660DD9e130A5481 // cvxeUSDFRAXBP
            );
            rotations[IERC20(0x3BECE5EC596331033726E5C6C188c313Ff4E3fE5)] = IAsset(
                0xE529B59C1764d6E5a274099Eb660DD9e130A5481 // cvxeUSDFRAXBP
            );
            rotations[IERC20(0x3C0a9143063Fc306F7D3cBB923ff4879d70Cf1EA)] = IAsset(
                0xB58D95003Af73CF76Ce349103726a51D4Ec8af17 // fUSDC
            );
            rotations[IERC20(0x6D05CB2CB647B58189FA16f81784C05B4bcd4fe9)] = IAsset(
                0xB58D95003Af73CF76Ce349103726a51D4Ec8af17 // fUSDC
            );
        } else {
            // Set up `deployer`
            deployer = TestIDeployer(0xFD18bA9B2f9241Ce40CDE14079c1cDA1502A8D0A);

            // Set up `anastasius`
            anastasiuses[IRToken(0xCc7FF230365bD730eE4B352cC2492CEdAC49383e)] = IGovernor(
                0x5Ef74A083Ac932b5f050bf41cDe1F67c659b4b88 // hyUSD (base)
            );
            anastasiuses[IRToken(0xCb327b99fF831bF8223cCEd12B1338FF3aA322Ff)] = IGovernor(
                0x8A11D590B32186E1236B5E75F2d8D72c280dc880 // bsdETH
            );
            anastasiuses[IRToken(0xfE0D6D83033e313691E96909d2188C150b834285)] = IGovernor(
                0xaeCa35F0cB9d12D68adC4d734D4383593F109654 // iUSDC
            );
            anastasiuses[IRToken(0xC9a3e2B3064c1c0546D3D0edc0A748E9f93Cf18d)] = IGovernor(
                0xC8f487B34251Eb76761168B70Dc10fA38B0Bd90b // Vaya
            );
            anastasiuses[IRToken(0x641B0453487C9D14c5df96d45a481ef1dc84e31f)] = IGovernor(
                0x437b525F96A2Da0A4b165efe27c61bea5c8d3CD4 // MAAT
            );

            // Set up `assets`
            for (uint256 i = 0; i < BASE_ASSETS.length; i++) {
                IERC20 erc20 = BASE_ASSETS[i].erc20();
                require(assets[erc20] == IAsset(address(0)), "duplicate asset");
                assets[erc20] = IAsset(BASE_ASSETS[i]);
            }

            // Set up wrapper `rotations`
            // <3.4.0 ERC20 => 3.4.0 Asset
            rotations[IERC20(0x184460704886f9F2A7F3A0c2887680867954dC6E)] = IAsset(
                0xC19f5d60e2Aca1174f3D5Fe189f0A69afaB76f50 // saBasUSDC
            );
            rotations[IERC20(0xA694f7177C6c839C951C74C797283B35D0A486c8)] = IAsset(
                0xf7a9D27c3B60c78c6F6e2c2d6ED6E8B94b352461 // wcUSDCv3
            );
        }
    }

    // Cast once-per-sender, which is assumed to be the timelock
    /// @param rToken The RToken to upgrade
    /// @param alexios The corresponding Governor Alexios for the RToken
    /// @dev Requirement: has administration of Timelock and RToken. revoked at end of execution
    function castSpell1(IRToken rToken, IGovernor alexios) external {
        // Can only cast once
        require(!oneCast[msg.sender], "repeat cast");
        oneCast[msg.sender] = true;

        IMain main = rToken.main();
        TimelockController timelock = TimelockController(payable(msg.sender));

        // Validations
        require(keccak256(abi.encodePacked(alexios.name())) == ALEXIOS_HASH, "not alexios");
        require(timelock.hasRole(PROPOSER_ROLE, address(alexios)), "alexios not timelock admin");
        require(timelock.hasRole(TIMELOCK_ADMIN_ROLE, address(this)), "must be timelock admin");
        require(main.hasRole(MAIN_OWNER_ROLE, msg.sender), "timelock does not own Main");
        require(main.hasRole(MAIN_OWNER_ROLE, address(this)), "must be owner of Main");

        // Determine which anastasius to use for the RToken
        IGovernor anastasius = anastasiuses[rToken];
        require(address(anastasius) != address(0), "unsupported RToken");

        Components memory proxy;
        proxy.assetRegistry = main.assetRegistry();
        proxy.basketHandler = main.basketHandler();
        proxy.backingManager = main.backingManager();
        proxy.broker = main.broker();
        proxy.distributor = main.distributor();
        proxy.furnace = main.furnace();
        proxy.rToken = rToken;
        proxy.rTokenTrader = main.rTokenTrader();
        proxy.rsrTrader = main.rsrTrader();
        proxy.stRSR = main.stRSR();

        // Proxy Upgrades
        {
            (
                IMain mainImpl,
                Components memory compImpls,
                TradePlugins memory tradingImpls
            ) = deployer.implementations();
            UUPSUpgradeable(address(main)).upgradeTo(address(mainImpl));
            UUPSUpgradeable(address(proxy.assetRegistry)).upgradeTo(
                address(compImpls.assetRegistry)
            );
            UUPSUpgradeable(address(proxy.backingManager)).upgradeTo(
                address(compImpls.backingManager)
            );
            UUPSUpgradeable(address(proxy.basketHandler)).upgradeTo(
                address(compImpls.basketHandler)
            );
            UUPSUpgradeable(address(proxy.broker)).upgradeTo(address(compImpls.broker));
            UUPSUpgradeable(address(proxy.distributor)).upgradeTo(address(compImpls.distributor));
            UUPSUpgradeable(address(proxy.furnace)).upgradeTo(address(compImpls.furnace));
            UUPSUpgradeable(address(proxy.rTokenTrader)).upgradeTo(address(compImpls.rTokenTrader));
            UUPSUpgradeable(address(proxy.rsrTrader)).upgradeTo(address(compImpls.rsrTrader));
            UUPSUpgradeable(address(proxy.stRSR)).upgradeTo(address(compImpls.stRSR));
            UUPSUpgradeable(address(proxy.rToken)).upgradeTo(address(compImpls.rToken));

            // Trading plugins
            TestIBroker(address(proxy.broker)).setDutchTradeImplementation(tradingImpls.dutchTrade);
            TestIBroker(address(proxy.broker)).setBatchTradeImplementation(
                tradingImpls.gnosisTrade
            );

            // cacheComponents()
            ICachedComponent(address(proxy.broker)).cacheComponents();
        }

        // Scale the reward downwards by the blocktime
        // This assumption only makes sense if the old Governor is Alexios, which has been checked
        {
            uint48 blocktime = mainnet ? 12 : 2;
            proxy.furnace.setRatio(proxy.furnace.ratio() / blocktime);
            TestIStRSR(address(proxy.stRSR)).setRewardRatio(
                TestIStRSR(address(proxy.stRSR)).rewardRatio() / blocktime
            );
        }

        // Set trading delay to 0
        TestIBackingManager(address(proxy.backingManager)).setTradingDelay(0);

        // Asset registry updates
        {
            IERC20[] memory erc20s = proxy.assetRegistry.erc20s();
            for (uint256 i = 0; i < erc20s.length; i++) {
                IERC20 erc20 = erc20s[i];
                if (address(erc20) == address(rToken)) continue;
                if (assets[erc20] != IAsset(address(0))) {
                    // if we have a new asset with that erc20, swapRegistered()
                    proxy.assetRegistry.swapRegistered(assets[erc20]);
                } else if (
                    // if we have a rotated asset
                    rotations[erc20] != IAsset(address(0)) &&
                    !proxy.assetRegistry.isRegistered(rotations[erc20].erc20())
                ) {
                    proxy.assetRegistry.register(rotations[erc20]);
                }
                // assets being deprecated in 3.4.0 will be skipped and left in baskets
            }

            // RTokenAsset
            proxy.assetRegistry.swapRegistered(
                deployer.deployRTokenAsset(
                    rToken,
                    proxy.assetRegistry.toAsset(IERC20(address(rToken))).maxTradeVolume()
                )
            );

            // Unregister TUSD if registered -- oracle is fully offline as of at least May 4th, 2024
            if (
                proxy.assetRegistry.isRegistered(IERC20(0x0000000000085d4780B73119b644AE5ecd22b376))
            ) {
                proxy.assetRegistry.unregister(IAsset(0x7F9999B2C9D310a5f48dfD070eb5129e1e8565E2));
            }
        }

        // Set new prime basket with rotated collateral
        {
            (IERC20[] memory primeERC20s, , uint192[] memory targetAmts) = TestIBasketHandler(
                address(proxy.basketHandler)
            ).getPrimeBasket();

            bool newBasket;
            for (uint256 i = 0; i < primeERC20s.length; i++) {
                if (rotations[primeERC20s[i]] != IAsset(address(0))) {
                    primeERC20s[i] = IERC20(address(rotations[primeERC20s[i]].erc20()));
                    newBasket = true;
                }
            }

            // Set baskets
            if (newBasket) {
                proxy.basketHandler.setPrimeBasket(primeERC20s, targetAmts);
            }
            proxy.basketHandler.refreshBasket();
            require(proxy.basketHandler.status() == CollateralStatus.SOUND, "basket not sound");
        }

        // Replace Alexios with Anastasius
        timelock.revokeRole(EXECUTOR_ROLE, address(alexios));
        timelock.revokeRole(PROPOSER_ROLE, address(alexios));
        timelock.revokeRole(CANCELLER_ROLE, address(alexios));
        timelock.grantRole(EXECUTOR_ROLE, address(anastasius));
        timelock.grantRole(PROPOSER_ROLE, address(anastasius));
        timelock.grantRole(CANCELLER_ROLE, address(anastasius));

        // Renounce adminships
        main.renounceRole(MAIN_OWNER_ROLE, address(this));
        assert(!main.hasRole(MAIN_OWNER_ROLE, address(this)));
        timelock.renounceRole(TIMELOCK_ADMIN_ROLE, address(this));
        assert(!timelock.hasRole(TIMELOCK_ADMIN_ROLE, address(this)));
    }

    // Cast once-per-sender, which is assumed to be the timelock
    /// @param rToken The RToken to upgrade
    /// @dev Requirement: has administration of RToken. revoked at end of execution
    ///      Assumption: no balances above minTradeVolume of non-basket assets
    function castSpell2(IRToken rToken) external {
        require(oneCast[msg.sender], "step 1 not cast");

        // Can only cast once
        require(!twoCast[msg.sender], "repeat cast");
        twoCast[msg.sender] = true;

        IMain main = rToken.main();
        require(main.hasRole(MAIN_OWNER_ROLE, msg.sender), "timelock does not own Main");

        IAssetRegistry assetRegistry = main.assetRegistry();
        IBasketHandler basketHandler = main.basketHandler();
        Registry memory reg = assetRegistry.getRegistry();
        require(basketHandler.fullyCollateralized(), "not fully collateralized");

        for (uint256 i = 0; i < reg.erc20s.length; i++) {
            IERC20 erc20 = reg.erc20s[i];
            if (!reg.assets[i].isCollateral()) continue; // skip pure assets

            if (
                rotations[erc20] != IAsset(address(0)) ||
                (assets[erc20] == IAsset(address(0)) && basketHandler.quantity(erc20) == 0)
            ) {
                // unregister rotated assets and non-3.4.0 assets not in the reference basket
                assetRegistry.unregister(reg.assets[i]);
            }
        }
        require(main.basketHandler().status() == CollateralStatus.SOUND, "basket not sound");
        // check we did not unregister anything in the basket

        // Renounce adminships
        TimelockController timelock = TimelockController(payable(msg.sender));
        main.renounceRole(MAIN_OWNER_ROLE, address(this));
        assert(!main.hasRole(MAIN_OWNER_ROLE, address(this)));
        timelock.renounceRole(TIMELOCK_ADMIN_ROLE, address(this));
        assert(!timelock.hasRole(TIMELOCK_ADMIN_ROLE, address(this))); // execessive revoke
    }
}

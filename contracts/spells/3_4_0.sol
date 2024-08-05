// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
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
 * The upgrade contract for the 3.4.0 release. Each spell function can only be cast once per RToken.
 *
 * Before casting each spell() function this contract must have MAIN_OWNER_ROLE of Main.
 * After casting each spell this contract will revoke its adminship of Main.
 *
 * The spell function should be called by the timelock owning Main. Governance should NOT
 * grant this spell ownership without immediately executing one of the spell functions after.
 *
 * WARNING: Only cast spell 2 after
 *          (i) all reward tokens have been claimed AND
 *          (ii) all rebalancing + revenue auctions have been fully processed.
 *          More specifically: All non-backing assets should have a balance under minTradeVolume,
 *                             and there should be no more non-backing assets to claim.
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
        IAsset(0x994455cE66Fd984e2A0A0aca453e637810a8f032), // cvxeUSDFRAXBP
        IAsset(0x3d21f841C0Fb125176C1DBDF0DE196b071323A75), // crvMIM3Pool
        IAsset(0x05F164E71C46a8f8FB2ba71550a00eeC9FCd85cd), // cvxETHPlusETH
        IAsset(0xCDC5f5E041b49Cad373E94930E2b3bE30be70535), // crveUSDFRAXBP
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
    IAsset[9] BASE_ASSETS = [
        IAsset(0x02062c16c28A169D1f2F5EfA7eEDc42c3311ec23), // RSR
        IAsset(0xB8794Fb1CCd62bFe631293163F4A3fC2d22e37e0), // COMP
        IAsset(0x3E40840d0282C9F9cC7d17094b5239f87fcf18e5), // DAI
        IAsset(0xaa85216187F92a781D8F9Bcb40825E356ee2635a), // USDC
        IAsset(0x073BD162BBD05Cd2CF631B90D44239B8a367276e), // WETH
        IAsset(0x851B461a9744f4c9E996C03072cAB6f44Fa04d0D), // cbETH
        IAsset(0xC19f5d60e2Aca1174f3D5Fe189f0A69afaB76f50), // saBasUSDC
        IAsset(0xf7a9D27c3B60c78c6F6e2c2d6ED6E8B94b352461), // cUSDCv3
        IAsset(0x8b4374005291B8FCD14C4E947604b2FB3C660A73) // wstETH
    ];

    // =======================================================================================

    using EnumerableSet for EnumerableSet.Bytes32Set;

    TestIDeployer public deployer;

    struct NewGovernance {
        IGovernor anastasius;
        TimelockController timelock;
    }

    // RToken => [IGovernor, TimelockController]
    mapping(IRToken => NewGovernance) public newGovs;

    // Invariant
    // for each erc20 to be included in 3.4.0:
    //   assets[erc20] == address(0) XOR rotations[erc20] == address(0)
    // (checked in constructor)

    // 3.4.0 ERC20 => 3.4.0 Asset
    mapping(IERC20 => IAsset) public assets; // ALL 3.4.0 assets

    // <3.4.0 ERC20 => 3.4.0 Asset
    mapping(IERC20 => IAsset) public rotations; // erc20 rotations

    // RToken => bool
    mapping(IRToken => bool) public oneCast;
    mapping(IRToken => bool) public twoCast;

    bool public mainnet; // !mainnet | base

    // empty between txs
    EnumerableSet.Bytes32Set private uniqueTargetNames;

    // =======================================================================================

    constructor(bool _mainnet) {
        // we have to pass-in `_mainnet` because chainid is not reliable during testing
        require(
            block.chainid == 1 || block.chainid == 31337 || block.chainid == 8453,
            "unsupported chain"
        );
        mainnet = _mainnet;

        // Setup `assets` array
        if (_mainnet) {
            // Setup `deployer`
            deployer = TestIDeployer(0x2204EC97D31E2C9eE62eaD9e6E2d5F7712D3f1bF);

            // Setup `newGovs`
            // eUSD
            newGovs[IRToken(0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F)] = NewGovernance(
                IGovernor(0xf4A9288D5dEb0EaE987e5926795094BF6f4662F8),
                TimelockController(payable(0x7BEa807798313fE8F557780dBD6b829c1E3aD560))
            );

            // ETH+
            newGovs[IRToken(0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8)] = NewGovernance(
                IGovernor(0x868Fe81C276d730A1995Dc84b642E795dFb8F753),
                TimelockController(payable(0x5d8A7DC9405F08F14541BA918c1Bf7eb2dACE556))
            );

            // hyUSD (mainnet)
            newGovs[IRToken(0xaCdf0DBA4B9839b96221a8487e9ca660a48212be)] = NewGovernance(
                IGovernor(0x3F26EF1460D21A99425569Ef3148Ca6059a7eEAe),
                TimelockController(payable(0x788Fd297B4d497e44e4BF25d642fbecA3018B5d2))
            );

            // USDC+
            newGovs[IRToken(0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b)] = NewGovernance(
                IGovernor(0xfB4b59f89657B76f2AdBCFf5786369f0890c0E6e),
                TimelockController(payable(0x9D769914eD962C4E609C8d7e4965940799C2D6C0))
            );

            // USD3
            newGovs[IRToken(0x0d86883FAf4FfD7aEb116390af37746F45b6f378)] = NewGovernance(
                IGovernor(0x441808e20E625e0094b01B40F84af89436229279),
                TimelockController(payable(0x12e4F043c6464984A45173E0444105058b6C3c7B))
            );

            // rgUSD
            newGovs[IRToken(0x78da5799CF427Fee11e9996982F4150eCe7a99A7)] = NewGovernance(
                IGovernor(0xA82Df5F4c8669a358CE54b8784103854a7f11dAf),
                TimelockController(payable(0xf33b8F2284BCa1B1A78142aE609F2a3Ad30358f3))
            );

            // Setup wrapper `rotations`
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
                0x994455cE66Fd984e2A0A0aca453e637810a8f032 // cvxeUSDFRAXBP
            );
            rotations[IERC20(0x3BECE5EC596331033726E5C6C188c313Ff4E3fE5)] = IAsset(
                0x994455cE66Fd984e2A0A0aca453e637810a8f032 // cvxeUSDFRAXBP
            );
            rotations[IERC20(0x6D05CB2CB647B58189FA16f81784C05B4bcd4fe9)] = IAsset(
                0xB58D95003Af73CF76Ce349103726a51D4Ec8af17 // fUSDC
            );

            // Setup updated `assets`
            for (uint256 i = 0; i < MAINNET_ASSETS.length; i++) {
                IERC20 erc20 = MAINNET_ASSETS[i].erc20();
                require(address(assets[erc20]) == address(0), "duplicate asset");
                require(address(rotations[erc20]) == address(0), "duplicate rotation/update");
                assets[erc20] = MAINNET_ASSETS[i];
            }
        } else {
            // Setup `deployer`
            deployer = TestIDeployer(0xFD18bA9B2f9241Ce40CDE14079c1cDA1502A8D0A);

            // Setup `newGovs`
            // hyUSD (base)
            newGovs[IRToken(0xCc7FF230365bD730eE4B352cC2492CEdAC49383e)] = NewGovernance(
                IGovernor(0xffef97179f58a582dEf73e6d2e4BcD2BDC8ca128),
                TimelockController(payable(0x4284D76a03F9B398FF7aEc58C9dEc94b289070CF))
            );

            // bsdETH
            newGovs[IRToken(0xCb327b99fF831bF8223cCEd12B1338FF3aA322Ff)] = NewGovernance(
                IGovernor(0x21fBa52dA03e1F964fa521532f8B8951fC212055),
                TimelockController(payable(0xe664d294824C2A8C952A10c4034e1105d2907F46))
            );

            // iUSDC
            newGovs[IRToken(0xfE0D6D83033e313691E96909d2188C150b834285)] = NewGovernance(
                IGovernor(0xB5Cf3238b6EdDf8e264D44593099C5fAaFC3F96D),
                TimelockController(payable(0x520CF948147C3DF196B8a21cd3687e7f17555032))
            );

            // Vaya
            newGovs[IRToken(0xC9a3e2B3064c1c0546D3D0edc0A748E9f93Cf18d)] = NewGovernance(
                IGovernor(0xA6Fa215AB89e24310dc27aD86111803C443186Eb),
                TimelockController(payable(0x48f4EA2c10E6665A7B77Ad6B9BD928b21CBe176F))
            );

            // MAAT
            newGovs[IRToken(0x641B0453487C9D14c5df96d45a481ef1dc84e31f)] = NewGovernance(
                IGovernor(0x382Ee5dBaCA900211D0B64D2FdB180C4B276E5ce),
                TimelockController(payable(0x88CF647f1CE5a83E699157b9D84b5a39266F010D))
            );

            // Setup wrapper `rotations`
            // <3.4.0 ERC20 => 3.4.0 Asset
            rotations[IERC20(0x184460704886f9F2A7F3A0c2887680867954dC6E)] = IAsset(
                0xC19f5d60e2Aca1174f3D5Fe189f0A69afaB76f50 // saBasUSDC
            );
            rotations[IERC20(0xA694f7177C6c839C951C74C797283B35D0A486c8)] = IAsset(
                0xf7a9D27c3B60c78c6F6e2c2d6ED6E8B94b352461 // wcUSDCv3
            );

            // Setup updated `assets`
            for (uint256 i = 0; i < BASE_ASSETS.length; i++) {
                IERC20 erc20 = BASE_ASSETS[i].erc20();
                require(address(assets[erc20]) == address(0), "duplicate asset");
                require(address(rotations[erc20]) == address(0), "duplicate rotation/update");
                assets[erc20] = BASE_ASSETS[i];
            }
        }
    }

    // Cast once-per-rToken. Caller MUST be the timelock owning Main.
    /// @param rToken The RToken to upgrade
    /// @dev Requirement: this contract has admin of RToken via MAIN_OWNER_ROLE
    function castSpell1(IRToken rToken) external {
        // Can only cast once
        require(!oneCast[rToken], "repeat cast");
        oneCast[rToken] = true;

        // Validations
        IMain main = rToken.main();
        require(main.hasRole(MAIN_OWNER_ROLE, msg.sender), "caller does not own Main"); // crux
        require(main.hasRole(MAIN_OWNER_ROLE, address(this)), "must be owner of Main");

        // Validate new timelock
        NewGovernance storage newGov = newGovs[rToken];
        require(address(newGov.anastasius) != address(0), "unsupported RToken");
        require(
            newGov.timelock.hasRole(PROPOSER_ROLE, address(newGov.anastasius)),
            "anastasius not proposer"
        );
        require(
            newGov.timelock.hasRole(CANCELLER_ROLE, address(newGov.anastasius)),
            "not canceller"
        );
        require(
            newGov.timelock.hasRole(EXECUTOR_ROLE, address(newGov.anastasius)),
            "anastasius not executor"
        );
        require(
            newGov.timelock.hasRole(TIMELOCK_ADMIN_ROLE, address(newGov.timelock)),
            "timelock not admin of itself"
        );

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
            Implementations memory impls = deployer.implementations();

            UUPSUpgradeable(address(main)).upgradeTo(address(impls.main));
            UUPSUpgradeable(address(proxy.assetRegistry)).upgradeTo(
                address(impls.components.assetRegistry)
            );
            UUPSUpgradeable(address(proxy.backingManager)).upgradeTo(
                address(impls.components.backingManager)
            );
            UUPSUpgradeable(address(proxy.basketHandler)).upgradeTo(
                address(impls.components.basketHandler)
            );
            UUPSUpgradeable(address(proxy.broker)).upgradeTo(address(impls.components.broker));
            UUPSUpgradeable(address(proxy.distributor)).upgradeTo(
                address(impls.components.distributor)
            );
            UUPSUpgradeable(address(proxy.furnace)).upgradeTo(address(impls.components.furnace));
            UUPSUpgradeable(address(proxy.rTokenTrader)).upgradeTo(
                address(impls.components.rTokenTrader)
            );
            UUPSUpgradeable(address(proxy.rsrTrader)).upgradeTo(
                address(impls.components.rsrTrader)
            );
            UUPSUpgradeable(address(proxy.stRSR)).upgradeTo(address(impls.components.stRSR));
            UUPSUpgradeable(address(proxy.rToken)).upgradeTo(address(impls.components.rToken));

            // Trading plugins
            TestIBroker(address(proxy.broker)).setDutchTradeImplementation(
                impls.trading.dutchTrade
            );
            TestIBroker(address(proxy.broker)).setBatchTradeImplementation(
                impls.trading.gnosisTrade
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
        }

        // Rotate ERC20s in basket
        {
            (
                IERC20[] memory primeERC20s,
                bytes32[] memory targetNames,
                uint192[] memory targetAmts
            ) = TestIBasketHandler(address(proxy.basketHandler)).getPrimeBasket();

            // Rotate ERC20s in prime basket
            bool newBasket;
            for (uint256 i = 0; i < primeERC20s.length; i++) {
                if (rotations[primeERC20s[i]] != IAsset(address(0))) {
                    primeERC20s[i] = IERC20(address(rotations[primeERC20s[i]].erc20()));
                    newBasket = true;
                }

                uniqueTargetNames.add(targetNames[i]);
            }
            if (newBasket) proxy.basketHandler.forceSetPrimeBasket(primeERC20s, targetAmts);

            // Rotate ERC20s in backup configs
            while (uniqueTargetNames.length() != 0) {
                bytes32 targetName = uniqueTargetNames.at(0);
                uniqueTargetNames.remove(targetName);

                (IERC20[] memory backupERC20s, uint256 max) = TestIBasketHandler(
                    address(proxy.basketHandler)
                ).getBackupConfig(targetName);

                // Rotate backupERC20s
                bool newBackup;
                for (uint256 i = 0; i < backupERC20s.length; i++) {
                    if (rotations[backupERC20s[i]] != IAsset(address(0))) {
                        backupERC20s[i] = IERC20(address(rotations[backupERC20s[i]].erc20()));
                        newBackup = true;
                    }
                }
                if (newBackup) proxy.basketHandler.setBackupConfig(targetName, max, backupERC20s);
            }

            // Unregister TUSD if registered -- oracle is fully offline as of at least May 4th, 2024
            if (
                proxy.assetRegistry.isRegistered(IERC20(0x0000000000085d4780B73119b644AE5ecd22b376))
            ) {
                proxy.assetRegistry.unregister(IAsset(0x7F9999B2C9D310a5f48dfD070eb5129e1e8565E2));
            }

            // Refresh basket
            proxy.basketHandler.refreshBasket();
            require(proxy.basketHandler.status() == CollateralStatus.SOUND, "basket not sound");
        }

        // Rotate timelocks
        main.grantRole(MAIN_OWNER_ROLE, address(newGov.timelock));
        assert(main.hasRole(MAIN_OWNER_ROLE, address(newGov.timelock)));
        main.revokeRole(MAIN_OWNER_ROLE, address(msg.sender));
        assert(!main.hasRole(MAIN_OWNER_ROLE, address(msg.sender)));

        // Renounce adminship
        main.renounceRole(MAIN_OWNER_ROLE, address(this));
        assert(!main.hasRole(MAIN_OWNER_ROLE, address(this)));
    }

    // Cast once-per-rToken. Caller MUST be the (new) timelock owning Main.
    /// @param rToken The RToken to upgrade
    /// @dev Requirement: this contract has admin of RToken via MAIN_OWNER_ROLE
    /// @dev Assumption: all reward tokens claimed and no surplus balances above minTradeVolume
    /// @dev Warning: after casting an RToken may lose access to rewards earned by <3.4.0 assets
    function castSpell2(IRToken rToken) external {
        require(oneCast[rToken], "step 1 not cast");

        // Can only cast once
        require(!twoCast[rToken], "repeat cast");
        twoCast[rToken] = true;

        IMain main = rToken.main();
        require(main.hasRole(MAIN_OWNER_ROLE, msg.sender), "caller does not own Main");
        require(main.hasRole(MAIN_OWNER_ROLE, address(this)), "must be owner of Main");

        IAssetRegistry assetRegistry = main.assetRegistry();
        IBasketHandler basketHandler = main.basketHandler();
        Registry memory reg = assetRegistry.getRegistry();
        require(basketHandler.fullyCollateralized(), "not fully collateralized");

        // Unregister rotated and <3.4.0 collateral not in the reference basket
        // Warning: it is possible in principle that a <3.3.0 asset that earns rewards does not
        // contain a call to `erc20.claimRewards()` in its own claimRewards() function.
        for (uint256 i = 0; i < reg.erc20s.length; i++) {
            IERC20 erc20 = reg.erc20s[i];
            if (!reg.assets[i].isCollateral()) continue; // skip pure assets

            if (
                rotations[erc20] != IAsset(address(0)) ||
                (assets[erc20] == IAsset(address(0)) && basketHandler.quantity(erc20) == 0)
            ) {
                assetRegistry.unregister(reg.assets[i]);
            }
        }

        require(basketHandler.status() == CollateralStatus.SOUND, "basket not sound");
        // check we did not unregister anything in the basket

        // Renounce adminship
        main.renounceRole(MAIN_OWNER_ROLE, address(this));
        assert(!main.hasRole(MAIN_OWNER_ROLE, address(this)));
    }
}

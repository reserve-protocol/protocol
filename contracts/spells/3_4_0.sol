// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "../interfaces/IDeployer.sol";
import "../interfaces/IMain.sol";
import "../interfaces/ISpell.sol";

import "hardhat/console.sol";

// === Auth ====
bytes32 constant MAIN_OWNER_ROLE = bytes32("OWNER_ROLE");
bytes32 constant TIMELOCK_ADMIN_ROLE = keccak256("TIMELOCK_ADMIN_ROLE");
bytes32 constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
bytes32 constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
bytes32 constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

// === RTokens ===
// Mainnet
IRToken constant eUSD = IRToken(0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F);
IRToken constant ETHPlus = IRToken(0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8);
IRToken constant hyUSD_mainnet = IRToken(0xaCdf0DBA4B9839b96221a8487e9ca660a48212be);
IRToken constant USDCPlus = IRToken(0xFc0B1EEf20e4c68B3DCF36c4537Cfa7Ce46CA70b);
IRToken constant USD3 = IRToken(0x0d86883FAf4FfD7aEb116390af37746F45b6f378);
IRToken constant rgUSD = IRToken(0x78da5799CF427Fee11e9996982F4150eCe7a99A7);

// Base
IRToken constant hyUSD_base = IRToken(0xCc7FF230365bD730eE4B352cC2492CEdAC49383e);
IRToken constant bsdETH = IRToken(0xCb327b99fF831bF8223cCEd12B1338FF3aA322Ff);
IRToken constant iUSDC = IRToken(0xfE0D6D83033e313691E96909d2188C150b834285);
IRToken constant Vaya = IRToken(0xC9a3e2B3064c1c0546D3D0edc0A748E9f93Cf18d);

// === Anastasius Governors ===
// Mainnet
IGovernor constant ANASTASIUS_eUSD = IGovernor(0xfa4Cc3c65c5CCe085Fc78dD262d00500cf7546CD);
IGovernor constant ANASTASIUS_ETHPlus = IGovernor(0x991c13ff5e8bd3FFc59244A8cF13E0253C78d2bD);
IGovernor constant ANASTASIUS_hyUSD_mainnet = IGovernor(0xb79434b4778E5C1930672053f4bE88D11BbD1f97);
IGovernor constant ANASTASIUS_USDCPlus = IGovernor(0x6814F3489cbE3EB32b27508a75821073C85C12b7);
IGovernor constant ANASTASIUS_USD3 = IGovernor(0x16a0F420426FD102a85A7CcA4BA25f6be1E98cFc);
IGovernor constant ANASTASIUS_rgUSD = IGovernor(0xE5D337258a1e8046fa87Ca687e3455Eb8b626e1F);

// Base
IGovernor constant ANASTASIUS_hyUSD_base = IGovernor(0x5Ef74A083Ac932b5f050bf41cDe1F67c659b4b88);
IGovernor constant ANASTASIUS_bsdETH = IGovernor(0x8A11D590B32186E1236B5E75F2d8D72c280dc880);
IGovernor constant ANASTASIUS_iUSDC = IGovernor(0xaeCa35F0cB9d12D68adC4d734D4383593F109654);
IGovernor constant ANASTASIUS_Vaya = IGovernor(0xC8f487B34251Eb76761168B70Dc10fA38B0Bd90b);

// === 3.4.0 Implementations ===
TestIDeployer constant mainDeployer = TestIDeployer(0x2204EC97D31E2C9eE62eaD9e6E2d5F7712D3f1bF);
TestIDeployer constant baseDeployer = TestIDeployer(0xFD18bA9B2f9241Ce40CDE14079c1cDA1502A8D0A);

interface ICachedComponent {
    function cacheComponents() external;
}

// === 3.4.0 Assets ===
// See bottom of contract

/**
 * The upgrade spell for the 3.4.0 release. Can only be cast once per msg.sender.
 *
 * Expectation: cast by timelock after timelock grants administration and ownership of main
 *
 * REQUIREMENT before cast():
 *   - This spell must be an administrator of the timelock
 *   - This spell must be an owner of the RToken
 *
 * Only works on Mainnet and Base. Only supports RTokens listed on the Register as of May 1, 2024
 */
contract Upgrade3_4_0 is ISpell {
    mapping(IERC20 => IAsset) public assets;

    // msg.sender => bool
    mapping(address => bool) public castFrom;

    constructor() {
        if (block.chainid == 1 || block.chainid == 31337) {
            // Mainnet
            for (uint256 i = 0; i < MAINNET_ASSETS.length; i++) {
                IERC20 erc20 = MAINNET_ASSETS[i].erc20();
                require(assets[erc20] == IAsset(address(0)), "duplicate asset");
                assets[erc20] = IAsset(MAINNET_ASSETS[i]);
            }
        } else if (block.chainid == 8453) {
            // Base
            for (uint256 i = 0; i < BASE_ASSETS.length; i++) {
                IERC20 erc20 = BASE_ASSETS[i].erc20();
                require(assets[erc20] == IAsset(address(0)), "duplicate asset");
                assets[erc20] = IAsset(BASE_ASSETS[i]);
            }
        } else {
            revert("unsupported chain");
        }
    }

    // Cast once-per-sender
    /// @param rToken The RToken to upgrade
    /// @param alexios The corresponding Governor Alexios for the RToken
    /// @dev Requirement: has administration of Timelock and RToken. revoke at end of execution
    function cast(IRToken rToken, IGovernor alexios) external {
        // Can only cast once
        require(!castFrom[msg.sender], "repeat cast");
        castFrom[msg.sender] = true;

        // Must be timelock admin
        TimelockController timelock = TimelockController(payable(msg.sender));
        require(timelock.hasRole(TIMELOCK_ADMIN_ROLE, address(this)), "must be timelock admin");
        require(!timelock.hasRole(PROPOSER_ROLE, address(this)), "should NOT be proposer");
        require(!timelock.hasRole(EXECUTOR_ROLE, address(this)), "should NOT be executor");

        // Must be RToken owner
        IMain main = rToken.main();
        require(main.hasRole(MAIN_OWNER_ROLE, address(this)), "must be owner of Main");

        // Determine which anastasius to use for the RToken
        IGovernor anastasius;
        TestIDeployer deployer;
        if (block.chainid == 1 || block.chainid == 31337) {
            // Mainnet
            deployer = mainDeployer;

            if (rToken == eUSD) anastasius = ANASTASIUS_eUSD;
            if (rToken == ETHPlus) anastasius = ANASTASIUS_ETHPlus;
            if (rToken == hyUSD_mainnet) anastasius = ANASTASIUS_hyUSD_mainnet;
            if (rToken == USDCPlus) anastasius = ANASTASIUS_USDCPlus;
            if (rToken == USD3) anastasius = ANASTASIUS_USD3;
            if (rToken == rgUSD) anastasius = ANASTASIUS_rgUSD;
        } else if (block.chainid == 8453) {
            // Base
            deployer = baseDeployer;

            if (rToken == hyUSD_base) anastasius = ANASTASIUS_hyUSD_base;
            if (rToken == bsdETH) anastasius = ANASTASIUS_bsdETH;
            if (rToken == iUSDC) anastasius = ANASTASIUS_iUSDC;
            if (rToken == Vaya) anastasius = ANASTASIUS_Vaya;
        } else {
            revert("unsupported RToken");
        }
        require(address(anastasius) != address(0), "unsupported RToken");

        Components memory comps;
        comps.assetRegistry = main.assetRegistry();
        comps.basketHandler = main.basketHandler();
        comps.backingManager = main.backingManager();
        comps.broker = main.broker();
        comps.distributor = main.distributor();
        comps.furnace = main.furnace();
        comps.rToken = rToken;
        comps.rTokenTrader = main.rTokenTrader();
        comps.rsrTrader = main.rsrTrader();
        comps.stRSR = main.stRSR();

        // Component Proxy Upgrades
        {
            (
                IMain mainImpl,
                Components memory compImpls,
                TradePlugins memory tradingImpls
            ) = deployer.implementations();
            IBackingManager backingManager = main.backingManager();
            IBroker broker = main.broker();
            IDistributor distributor = main.distributor();
            IRevenueTrader rTokenTrader = main.rTokenTrader();
            IRevenueTrader rsrTrader = main.rsrTrader();

            UUPSUpgradeable(address(main)).upgradeTo(address(mainImpl));
            UUPSUpgradeable(address(comps.assetRegistry)).upgradeTo(
                address(compImpls.assetRegistry)
            );
            UUPSUpgradeable(address(comps.backingManager)).upgradeTo(
                address(compImpls.backingManager)
            );
            UUPSUpgradeable(address(comps.basketHandler)).upgradeTo(
                address(compImpls.basketHandler)
            );
            UUPSUpgradeable(address(comps.broker)).upgradeTo(address(compImpls.broker));
            UUPSUpgradeable(address(comps.distributor)).upgradeTo(address(compImpls.distributor));
            UUPSUpgradeable(address(comps.furnace)).upgradeTo(address(compImpls.furnace));
            UUPSUpgradeable(address(comps.rTokenTrader)).upgradeTo(address(compImpls.rTokenTrader));
            UUPSUpgradeable(address(comps.rsrTrader)).upgradeTo(address(compImpls.rsrTrader));
            UUPSUpgradeable(address(comps.stRSR)).upgradeTo(address(compImpls.stRSR));
            UUPSUpgradeable(address(comps.rToken)).upgradeTo(address(compImpls.rToken));

            // Trading plugins
            TestIBroker(address(broker)).setDutchTradeImplementation(tradingImpls.dutchTrade);
            TestIBroker(address(broker)).setBatchTradeImplementation(tradingImpls.gnosisTrade);

            // cacheComponents()
            ICachedComponent(address(broker)).cacheComponents();
            ICachedComponent(address(backingManager)).cacheComponents();
            ICachedComponent(address(distributor)).cacheComponents();
            ICachedComponent(address(rTokenTrader)).cacheComponents();
            ICachedComponent(address(rsrTrader)).cacheComponents();
        }

        // Scale the reward downwards by the blocktime
        {
            uint48 blocktime = block.chainid == 8453 ? 2 : 12; // checked prior for else cases
            comps.furnace.setRatio(comps.furnace.ratio() / blocktime);
            TestIStRSR(address(comps.stRSR)).setRewardRatio(
                TestIStRSR(address(comps.stRSR)).rewardRatio() / blocktime
            );
        }

        // Assets
        {
            IERC20[] memory erc20s = comps.assetRegistry.erc20s();
            for (uint256 i = 0; i < erc20s.length; i++) {
                if (address(erc20s[i]) == address(rToken)) continue;
                if (assets[erc20s[i]] == IAsset(address(0))) continue;

                // TODO
                // return to this, some RTokens will fail this and we can instead pass silently
                // require(assets[erc20s[i]] != IAsset(address(0)), "missing asset");
                comps.assetRegistry.swapRegistered(assets[erc20s[i]]);
            }

            // RTokenAsset -- do last
            comps.assetRegistry.swapRegistered(
                deployer.deployRTokenAsset(
                    rToken,
                    comps.assetRegistry.toAsset(IERC20(address(rToken))).maxTradeVolume()
                )
            );
        }
        comps.basketHandler.refreshBasket(); // will be DISABLED at this point

        // Replace Alexios with Anastasius
        timelock.revokeRole(EXECUTOR_ROLE, address(alexios));
        timelock.revokeRole(PROPOSER_ROLE, address(alexios));
        timelock.revokeRole(CANCELLER_ROLE, address(alexios)); // some aren't set up as canceller; should be fine
        timelock.grantRole(EXECUTOR_ROLE, address(anastasius));
        timelock.grantRole(PROPOSER_ROLE, address(anastasius));
        timelock.grantRole(CANCELLER_ROLE, address(anastasius));

        // Renounce adminships
        main.renounceRole(MAIN_OWNER_ROLE, address(this));
        assert(!main.hasRole(MAIN_OWNER_ROLE, address(this)));
        timelock.renounceRole(TIMELOCK_ADMIN_ROLE, address(this));
        assert(!timelock.hasRole(TIMELOCK_ADMIN_ROLE, address(this)));
    }

    // === Asset Address Constants ===

    IAsset[58] MAINNET_ASSETS = [
        IAsset(0x591529f039Ba48C3bEAc5090e30ceDDcb41D0EaA), // RSR
        IAsset(0xF4493581D52671a9E04d693a68ccc61853bceEaE),
        IAsset(0x63eDdF26Bc65eDa1D1c0147ce8E23c09BE963596),
        IAsset(0xc18bF46F178F7e90b9CD8b7A8b00Af026D5ce3D3),
        IAsset(0x7ef93b20C10E6662931b32Dd9D4b85861eB2E4b8),
        IAsset(0xEc375F2984D21D5ddb0D82767FD8a9C4CE8Eec2F),
        IAsset(0x442f8fc98e3cc6B3d49a66f9858Ac9B6e70Dad3e),
        IAsset(0xe7Dcd101A027Ec34860ECb634a2797d0D2dc4d8b),
        IAsset(0x4C0B21Acb267f1fAE4aeFA977A26c4a63C9B35e6),
        IAsset(0x97bb4a995b98b1BfF99046b3c518276f78fA5250),
        IAsset(0x9ca9A9cdcE9E943608c945E7001dC89EB163991E),
        IAsset(0xc4240D22FFa144E2712aACF3E2cC302af0339ED0),
        IAsset(0x8d753659D4E4e4b4601c7F01Dc1c920cA538E333),
        IAsset(0x01F9A6bf339cff820cA503A56FD3705AE35c27F7),
        IAsset(0xda5cc207CCefD116fF167a8ABEBBd52bD67C958E),
        IAsset(0x337E418b880bDA5860e05D632CF039B7751B907B),
        IAsset(0x043be931D9C4422e1cFeA528e19818dcDfdE9Ebc),
        IAsset(0x5ceadb6606C5D82FcCd3f9b312C018fE1f8aa6dA),
        IAsset(0xa0c02De8FfBb9759b9beBA5e29C82112688A0Ff4),
        IAsset(0xC0f89AFcb6F1c4E943aA61FFcdFc41fDcB7D84DD),
        IAsset(0x4d3A8507a8eb9036895efdD1a462210CE58DE4ad),
        IAsset(0x832D65735E541c0404a58B741bEF5652c2B7D0Db),
        IAsset(0xADDca344c92Be84A053C5CBE8e067460767FB816),
        IAsset(0xb7049ee9F533D32C9434101f0645E6Ea5DFe2cdb),
        IAsset(0x987f5e0f845D46262893e680b652D8aAF1B5bCc0),
        IAsset(0xB58D95003Af73CF76Ce349103726a51D4Ec8af17),
        IAsset(0xD5254b740FbEF6AAcD674936ea7Fb9f4053781aF),
        IAsset(0xA0a620B94446a7DC8952ECf252FcC495eeC65873),
        IAsset(0xFd9c32198D3cf3ad3b165918FD78De3654cb22eA),
        IAsset(0x33Ba1BC07b0fafb4BBC1520B330081b91ca6bdf0),
        IAsset(0x8E5ADdC553962DAcdF48106B6218AC93DA9617b2),
        IAsset(0x5315Fbe0CEB299F53aE375f65fd9376767C8224c),
        IAsset(0xE529B59C1764d6E5a274099Eb660DD9e130A5481),
        IAsset(0x3d21f841C0Fb125176C1DBDF0DE196b071323A75),
        IAsset(0xc4a5Fb266E8081D605D87f0b1290F54B0a5Dc221),
        IAsset(0x945b0ad788dD6dB3864AB23876C68C1bf000d237),
        IAsset(0x692cf8CE08d03eF1f8C3dCa82F67935fa9417B62),
        IAsset(0xf59a7987EDd5380cbAb30c37D1c808686f9b67B9),
        IAsset(0x62a9DDC6FF6077E823690118eCc935d16A8de47e),
        IAsset(0xC8b80813cad9139D0eeFe38C711a11b20147aA54),
        IAsset(0x2F8F8Ac64ECbAC38f212b05115836120784a29F7),
        IAsset(0xC5d03FB7A38E6025D9A32C7444cfbBfa18B7D656),
        IAsset(0x7be70371e7ECd9af5A5b49015EC8F8C336B52D81),
        IAsset(0x75B6921925e8BD632380706e722035752ffF175d),
        IAsset(0xA402078f0A2e077Ea2b1Fb3b6ab74F0cBA10E508),
        IAsset(0x4a139215D9E696c0e7618a441eD3CFd12bbD8CD6),
        IAsset(0x1573416df7095F698e37A954D9e951868E526650),
        IAsset(0xb3A3552Cc52411dFF6D520C6F725E6F9e11001EF),
        IAsset(0x0b7DcCBceA6f985301506D575E2661bf858CdEcC),
        IAsset(0x00F820794Bda3fb01E5f159ee1fF7c8409fca5AB),
        IAsset(0x58a41c87f8C65cf21f961b570540b176e408Cf2E),
        IAsset(0x3017d881724D93783e7f065Cc5F62c81C62c36A0),
        IAsset(0x4895b9aee383b5dec499F54172Ccc7Ee05FC8Bbc),
        IAsset(0xBd01C789Be742688fb73F6aE46f1320196B6c973),
        IAsset(0x3421d2cB19c8E69c6FA642C43e60cD943e75Ca8b),
        IAsset(0x9Fc0F31e2D26C437461a9eEBfe858d17e2611Ea5),
        IAsset(0x69c6597690B8Df61D15F201519C03725bdec40c1),
        IAsset(0x4c891fCa6319d492866672E3D2AfdAAA5bDcfF67)
    ];

    IAsset[11] BASE_ASSETS = [
        IAsset(0x02062c16c28A169D1f2F5EfA7eEDc42c3311ec23), // RSR
        IAsset(0xB8794Fb1CCd62bFe631293163F4A3fC2d22e37e0),
        IAsset(0xEE527CC63122732532d0f1ad33Ec035D30f3050f),
        IAsset(0x3E40840d0282C9F9cC7d17094b5239f87fcf18e5),
        IAsset(0xaa85216187F92a781D8F9Bcb40825E356ee2635a),
        IAsset(0xD126741474B0348D9B0F4911573d8f543c01C2c4),
        IAsset(0x073BD162BBD05Cd2CF631B90D44239B8a367276e),
        IAsset(0x851B461a9744f4c9E996C03072cAB6f44Fa04d0D),
        IAsset(0xC19f5d60e2Aca1174f3D5Fe189f0A69afaB76f50),
        IAsset(0xf7a9D27c3B60c78c6F6e2c2d6ED6E8B94b352461),
        IAsset(0x8b4374005291B8FCD14C4E947604b2FB3C660A73)
    ];
}

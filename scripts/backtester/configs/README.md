# Backtest config format

```
{
    "collateralContract": "CurveStableRTokenMetapoolCollateral",
...
```
Specifies what collateral contrack to test.


```
    "startBlock": 15000000,
    "stride": 1,
    "endBlock": 17590000,
...
```
What block range to test. A stride of 1 means test every block, stride of 2 means test every second block in range etc.

```
    "collateralConfig": {
        "erc20": "0xAEda92e6A3B1028edc139A4ae56Ec881f3064D4F",
        "targetName": "0x5553440000000000000000000000000000000000000000000000000000000000",
        "priceTimeout": "604800",
        "chainlinkFeed": "0x0000000000000000000000000000000000000001",
        "oracleError": "1",
        "oracleTimeout": "1",
        "maxTradeVolume": "1000000000000000000000000",
        "defaultThreshold": "20000000000000000",
        "delayUntilDefault": "259200"
    },
    ...
```

The CollateralConfig, see solidity code for reference:

```
struct CollateralConfig {
    uint48 priceTimeout; // {s} The number of seconds over which saved prices decay
    AggregatorV3Interface chainlinkFeed; // Feed units: {target/ref}
    uint192 oracleError; // {1} The % the oracle feed can be off by
    IERC20Metadata erc20; // The ERC20 of the collateral token
    uint192 maxTradeVolume; // {UoA} The max trade volume, in UoA
    uint48 oracleTimeout; // {s} The number of seconds until a oracle value becomes invalid
    bytes32 targetName; // The bytes32 representation of the target name
    uint192 defaultThreshold; // {1} A value like 0.05 that represents a deviation tolerance
    // set defaultThreshold to zero to create SelfReferentialCollateral
    uint48 delayUntilDefault; // {s} The number of seconds an oracle can mulfunction
}
```

If `erc20Wrapper` field is set, the erc20 parameter will be dynamically set to the wrapper address as part of the backtest.

```
    "variants": [
        {
            "name": "CurveStableRTokenMetapoolCollateral-stkcvxeUSD3CRV-f:0.0",
            "args": [
                "0",
                {
                "nTokens": 2,
                "curvePool": "0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2",
                "poolType": 0,
                "feeds": [
                    ["0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD"],
                    ["0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6"]
                ],
                "oracleTimeouts": [["3660"], ["86460"]],
                "oracleErrors": [["10000000000000000"], ["2500000000000000"]],
                "lpToken": "0x3175Df0976dFA876431C2E9eE6Bc45b65d3473CC"
                },
                "0xAEda92e6A3B1028edc139A4ae56Ec881f3064D4F",
                "20000000000000000"
            ]
        },
        {
            "name": "CurveStableRTokenMetapoolCollateral-stkcvxeUSD3CRV-f:0.000001",
            "args": [
                "1000000000000",
                {
                "nTokens": 2,
                "curvePool": "0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2",
                "poolType": 0,
                "feeds": [
                    ["0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD"],
                    ["0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6"]
                ],
                "oracleTimeouts": [["3660"], ["86460"]],
                "oracleErrors": [["10000000000000000"], ["2500000000000000"]],
                "lpToken": "0x3175Df0976dFA876431C2E9eE6Bc45b65d3473CC"
                },
                "0xAEda92e6A3B1028edc139A4ae56Ec881f3064D4F",
                "20000000000000000"
            ]
        },
        ...
    ],
    ...
```
Variants let's you set the remaining parameters of the plugin constructor. Make sure that each variant name is unique. Usually we use this to test variations of revenuehiding.


```
    "erc20Wrapper": {
        "contract": "ConvexStakingWrapper",
        "args": [],
        "factoryOptions": {
            "libraries": { "CvxMining": "0xA6B8934a82874788043A75d50ca74a18732DC660" }
        },
        "calls": [
            {
                "method": "initialize",
                "args": [40]
            }
        ]
    }
  }
  ...
```

If the plugin depends on a wrapper token, then you can specify it here. `contract` specifies the contract to use. `args` is the constructor parameters.

`factoryOptions` can be used if the contract uses dynamic library linking.

`calls` is used if the wrapper contract requires some sort of setup after deployment.

# Backtest execution

The `ercWrapper` is shared between all `variants` and is deployed / initialised before running any backtests.

The `collateralConfig` is also shared between all variants. The `erc20` field gets set to the address of the `erc20Wrapper` before all backtests.

Each variant gets 4 million gas to execute. This means that you should probably not have more than 7 variants pr backtest, since total limit is around 30 million gas.

Each backtest sample is generated using the following solidity code:

```solidity
    function backtestPlugin(
        bytes memory deploymentByteCode,
        CollateralStatus oldStatus,
        uint48 whenDefault
    ) external returns (BackTestingDataPoint memory out) {
        ICollateral plugin;

        assembly {
            plugin := create(0, add(deploymentByteCode, 32), mload(deploymentByteCode))
        }
        plugin.refresh();
        uint48 delayUntilDefault = TestICollateral(address(plugin)).delayUntilDefault();

        try plugin.price() returns (uint192 low, uint192 high) {
            out.low = low;
            out.high = high;
            out.refPrTok = plugin.refPerTok();
            out.status = oldStatus;
            out.whenDefault = whenDefault;

            if (plugin.status() == CollateralStatus.IFFY) {
                if (oldStatus == CollateralStatus.SOUND) {
                    out.status = CollateralStatus.IFFY;
                    out.whenDefault = uint256(block.timestamp + delayUntilDefault);
                }
                if (oldStatus == CollateralStatus.IFFY && block.timestamp > out.whenDefault) {
                    out.status = CollateralStatus.DISABLED;
                }
            } else {
                out.status = CollateralStatus.SOUND;
                out.whenDefault = uint256(type(uint48).max);
            }
        } catch (bytes memory) {
            if (oldStatus == CollateralStatus.SOUND) {
                out.status = CollateralStatus.IFFY;
                out.whenDefault = uint256(block.timestamp + delayUntilDefault);
            }
            if (oldStatus == CollateralStatus.IFFY && block.timestamp > out.whenDefault) {
                out.status = CollateralStatus.DISABLED;
            }
        }
    }
```


// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.7.6;

import './interfaces/IUniswapV3Factory.sol';

import './UniswapV3PoolDeployer.sol';
import './NoDelegateCall.sol';

import './UniswapV3Pool.sol';

/// @title Canonical Uniswap V3 factory
/// @notice Deploys Uniswap V3 pools and manages ownership and control over pool protocol fees
contract UniswapV3Factory is IUniswapV3Factory, UniswapV3PoolDeployer, NoDelegateCall {
    /// @inheritdoc IUniswapV3Factory
    address public override owner;

    /// @inheritdoc IUniswapV3Factory
    mapping(uint24 => int24) public override feeAmountTickSpacing;
    /// @inheritdoc IUniswapV3Factory
    mapping(address => mapping(address => mapping(uint24 => address))) public override getPool;

    constructor(address _owner) {
        owner = _owner;
        emit OwnerChanged(address(0), _owner);

        feeAmountTickSpacing[500] = 10; // 0.05%
        emit FeeAmountEnabled(500, 10);
        feeAmountTickSpacing[3000] = 60; // 0.3%
        emit FeeAmountEnabled(3000, 60);
        feeAmountTickSpacing[5000] = 100; // 0.5%
        emit FeeAmountEnabled(5000, 100);
        feeAmountTickSpacing[10000] = 200; // 1%
        emit FeeAmountEnabled(10000, 200);
        feeAmountTickSpacing[20000] = 400; // 2%
        emit FeeAmountEnabled(20000, 400);
        feeAmountTickSpacing[30000] = 600; // 3%
        emit FeeAmountEnabled(30000, 600);
        feeAmountTickSpacing[40000] = 800; // 4%
        emit FeeAmountEnabled(40000, 800);
        feeAmountTickSpacing[50000] = 1000; // 5%
        emit FeeAmountEnabled(50000, 1000);
        feeAmountTickSpacing[60000] = 1200; // 6%
        emit FeeAmountEnabled(60000, 1200);
        feeAmountTickSpacing[70000] = 1400; // 7%
        emit FeeAmountEnabled(70000, 1400);
        feeAmountTickSpacing[80000] = 1600; // 8%
        emit FeeAmountEnabled(80000, 1600);
        feeAmountTickSpacing[90000] = 1800; // 9%
        emit FeeAmountEnabled(90000, 1800);
        feeAmountTickSpacing[100000] = 2000; // 10%
        emit FeeAmountEnabled(100000, 2000);
        feeAmountTickSpacing[110000] = 2200; // 11%
        emit FeeAmountEnabled(110000, 2200);
        feeAmountTickSpacing[120000] = 2400; // 12%
        emit FeeAmountEnabled(120000, 2400);
        feeAmountTickSpacing[130000] = 2600; // 13%
        emit FeeAmountEnabled(130000, 2600);
        feeAmountTickSpacing[140000] = 2800; // 14%
        emit FeeAmountEnabled(140000, 2800);
        feeAmountTickSpacing[150000] = 3000; // 15%
        emit FeeAmountEnabled(150000, 3000);
    }

    /// @inheritdoc IUniswapV3Factory
    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external override noDelegateCall returns (address pool) {
        require(tokenA != tokenB);
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0));
        int24 tickSpacing = feeAmountTickSpacing[fee];
        require(tickSpacing != 0);
        require(getPool[token0][token1][fee] == address(0));
        pool = deploy(address(this), token0, token1, fee, tickSpacing);
        getPool[token0][token1][fee] = pool;
        // populate mapping in the reverse direction, deliberate choice to avoid the cost of comparing addresses
        getPool[token1][token0][fee] = pool;
        emit PoolCreated(token0, token1, fee, tickSpacing, pool);
    }

    /// @inheritdoc IUniswapV3Factory
    function setOwner(address _owner) external override {
        require(msg.sender == owner);
        emit OwnerChanged(owner, _owner);
        owner = _owner;
    }

    /// @inheritdoc IUniswapV3Factory
    function enableFeeAmount(uint24 fee, int24 tickSpacing) public override {
        require(msg.sender == owner);
        require(fee < 1000000);
        // tick spacing is capped at 16384 to prevent the situation where tickSpacing is so large that
        // TickBitmap#nextInitializedTickWithinOneWord overflows int24 container from a valid tick
        // 16384 ticks represents a >5x price change with ticks of 1 bips
        require(tickSpacing > 0 && tickSpacing < 16384);
        require(feeAmountTickSpacing[fee] == 0);

        feeAmountTickSpacing[fee] = tickSpacing;
        emit FeeAmountEnabled(fee, tickSpacing);
    }
}

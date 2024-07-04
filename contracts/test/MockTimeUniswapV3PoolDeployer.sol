// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import '../interfaces/IUniswapV3PoolDeployer.sol';

import './MockTimeUniswapV3Pool.sol';

contract MockTimeUniswapV3PoolDeployer is IUniswapV3PoolDeployer {
    struct Parameters {
        address factory;
        address token0;
        address token1;
        uint24 fee;
        int24 tickSpacing;
    }

    Parameters public override parameters;

    event PoolDeployed(address pool);

    function deploy(
        address factory,
        address token0,
        address token1,
        uint24 fee,
        int24 tickSpacing,
        int256 buyLimit
    ) external returns (address pool) {
        parameters = Parameters({factory: factory, token0: token0, token1: token1, fee: fee, tickSpacing: tickSpacing});
        pool = address(
            new MockTimeUniswapV3Pool{salt: keccak256(abi.encode(token0, token1, fee))}(buyLimit)
        );
        emit PoolDeployed(pool);
        delete parameters;
    }
}

今天在学习的时候发现 STM32F1 在 FreeRTOS 中总是无法正常进入 Stop 模式，后面经过我的测试是调试器的原因。

最开始我以为是 FreeRTOS 的 Tick频繁中断导致，但是反复检查了低功耗相关的代码，都没有发现异常。后面debug的时候发现WFI始终没办法正常运行，最后经过查阅资料发现STM32 的DBGMCU模块中有一个 DBG_STOP​ 位：

DBGMCU->CR |= DBGMCU_CR_DBG_STOP;

当该位为 1​ 时，即使 MCU 执行了 WFI/WFE，调试器仍然会保持连接，部分时钟和外设不会关闭，导致 Stop 模式“名存实亡”。而在 FreeRTOS 环境下，由于系统存在 SysTick、PendSV、任务调度和中断活动，调试模块会被频繁触发，使得这种影响比裸机更加明显。

解决方式也非常简单，在进入低功耗前显式关闭调试功能即可：
__HAL_RCC_DBGMCU_CLK_ENABLE();
DBGMCU->CR &= ~DBGMCU_CR_DBG_STOP;

加上这段代码后，STM32F1 在 FreeRTOS 下可以稳定进入 Stop 模式，功耗表现也恢复正常。
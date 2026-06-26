首先对于为什么需要汇编，C 语言只能直接访问变量，不能直接操作 CPU 内部的寄存器，但是rtos的本质是让 CPU 在不同任务的栈之间来回切换，所以这个时候我们就需要使用汇编语言来保存和恢复寄存器。

之前没有接触过汇编，所以现在对写rtos需要的汇编进行了一下简单的学习：

ARM Cortex-M 有 16 个主要寄存器：R0 到 R15。
它们的功能分别是：
- R0～R3：一般用来传参数、临时计算。
- R4～R11：通常用来保存函数里的局部变量，函数用完了要原样还回去。
- R12：临时寄存器。
- R13 (SP)：栈指针，永远指向“栈顶”。栈是一块特殊的内存区域，专门用来保存临时数据，比如函数返回地址、局部变量等。SP 就是工人手中一个指向栈顶的指针，它有两个版本：MSP（主栈指针）和 PSP（进程栈指针），后面会说。
- R14 (LR)：链接寄存器，调用函数时，会把返回地址存在这里，方便跳回来。
- R15 (PC)：程序计数器，存放下一条要执行的指令地址。CPU 就是不断根据 PC 去取指令、执行。

所以，执行程序就是不断改变这些口袋里面的值

硬件自动压栈的只有8个寄存器：R0,R1,R2,R3,R12,LR,PC,xPSR，但是其他的八个并没有管，所以我们需要用汇编手动保存和恢复 R4～R11，以及切换 SP（栈指针）。

在单片机中，进入中断时LR会被写成EXC_RETURN，它告诉 CPU 中断返回后应该用什么栈（MSP 还是 PSP），以及返回什么模式（特权/非特权）。
- 0xFFFFFFF9：返回线程模式，使用 MSP。
- 0xFFFFFFFD：返回线程模式，使用 PSP。

任务运行时要用 PSP。中断服务程序一般用 MSP。

还有一个重要的寄存器叫 CONTROL。它的 bit[1] 是 SPSEL 位：
0 表示使用 MSP。
1 表示使用 PSP。

SVC_Handler要做的：让 CPU 从 MSP 切换到 PSP，并设置 CONTROL，这样以后在任务中只要发生中断，硬件就会自动用 PSP 压栈

感觉汇编学起来还是太头疼了，所以关于具体的使用我让ai帮我生成了一下语法总结：

| 指令 | 格式示例 | 作用（一句话） |
|------|----------|----------------|
| ldr | ldr r0, =变量 | 把变量的地址放进寄存器 |
| ldr | ldr r0, [r1] | 把内存（地址 = r1）的值读入寄存器 |
| str | str r0, [r1] | 把寄存器的值写入内存（地址 = r1） |
| mov | mov r0, #2 | 把数字 2 放入寄存器 |
| msr | msr psp, r0 | 把通用寄存器值写入特殊寄存器（如 PSP） |
| mrs | mrs r12, psp | 把特殊寄存器值读到通用寄存器 |
| stmdb | stmdb r12!, {r4-r11} | 压栈：先减地址，再存入多个寄存器，更新基址 |
| ldmia | ldmia r12!, {r4-r11} | 出栈：先读出多个寄存器，再增地址，更新基址 |
| push | push {lr} | 把 LR 压入当前栈 |
| pop | pop {lr} | 从当前栈弹出 LR |
| bl | bl 函数名 | 调用函数（自动保存返回地址到 LR） |
| bx | bx lr | 跳转到 LR 中的地址（异常返回时触发硬件恢复） |
| cmp | cmp r0, #0 | 比较（不存结果，影响标志位） |
| beq | beq 标号 | 相等则跳转 |
| cpsid i | cpsid i | 关全局中断 |
| cpsie i | cpsie i | 开全局中断 |

学会了以上东西，就可以借鉴一下freertos开始编写需要的汇编代码了

```c
// 启动第一个任务的汇编函数（用 SVC 异常触发）
__attribute__((naked)) void StartFirstTask(void) {
    __asm volatile (
        "ldr r0, =0xE000ED08    \n" // VTOR 的地址偏移，其实不需要
        "ldr r0, [r0]           \n"
        "ldr r0, [r0]           \n" // 第一个字的初始 MSP
        "msr msp, r0            \n" // 设置 MSP（可选，为了安全）
        "cpsie i                \n" // 开全局中断
        "cpsie f                \n"
        "dsb                    \n"
        "isb                    \n"
        "svc 0                  \n" // 触发 SVC 异常，进行首次切换
        "bx lr                  \n"
    );
}

// SVC 中断服务函数
__attribute__((naked)) void SVC_Handler(void) {
    __asm volatile (
        "ldr r0, =current_tcb   \n"
        "ldr r0, [r0]           \n"  // r0 = current_tcb
        "ldr r0, [r0]           \n"  // r0 = current_tcb->stack_ptr
        "ldmia r0!, {r4-r11}    \n"  // 手动恢复 R4-R11（首次无意义，但统一格式）
        "msr psp, r0            \n"  // 设置 PSP 为新的栈顶
        "mov r0, #2             \n"  // 返回后使用 PSP 的线程模式
        "msr control, r0        \n"
        "isb                    \n"
        "orr lr, lr, #0x04      \n"  // 这行可能多余，我们是 EXC_RETURN 自动处理
        "bx lr                  \n"
    );
}

// PendSV 中断服务函数
__attribute__((naked)) void PendSV_Handler(void) {
    __asm volatile (
        // 关闭中断（异常内已经自动屏蔽同级或低优先级，但仍可加）
        "cpsid i                \n"
        // 检查 current_tcb 是否为空
        "ldr r0, =current_tcb   \n"
        "ldr r0, [r0]           \n"
        "cmp r0, #0             \n"
        "beq PendSV_NoSave      \n"
        // 保存 R4-R11 到当前任务栈
        "mrs r12, psp           \n"  // r12 = 当前 PSP
        "stmdb r12!, {r4-r11}   \n"  // 压栈 R4-R11，r12 更新
        "ldr r1, =current_tcb   \n"
        "ldr r1, [r1]           \n"
        "str r12, [r1]          \n"  // 保存新的栈指针到 current_tcb->stack_ptr
PendSV_NoSave:
        // 调用 C 函数选择下一个任务
        "push {lr}              \n"
        "bl  zrtos_schedule_next \n" // 需要在 C 中实现，更新 next_tcb
        "pop {lr}               \n"
        // 加载 next_tcb 的栈指针
        "ldr r1, =next_tcb      \n"
        "ldr r1, [r1]           \n"
        "ldr r12, [r1]          \n"  // r12 = next_tcb->stack_ptr
        "ldmia r12!, {r4-r11}   \n"  // 恢复 R4-R11
        "msr psp, r12           \n"  // 更新 PSP
        // 更新 current_tcb
        "ldr r0, =next_tcb      \n"
        "ldr r0, [r0]           \n"
        "ldr r1, =current_tcb   \n"
        "str r0, [r1]           \n"
        "cpsie i                \n"
        "bx lr                  \n"  // EXC_RETURN 自动恢复 R0-R3,R12,LR,PC,xPSR
    );
}

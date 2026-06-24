window.onload = function() {
    setTimeout(() => {
        // 精准获取所有含有 LabelTime 的元素并移除
        const dates = document.querySelectorAll('.LabelTime');
        if (dates.length > 0) {
            dates.forEach(el => el.remove());
            console.log('✅ 已成功移除日期标签！');
        }
    }, 1000); // 延迟 1 秒，确保页面内容已全部加载
};

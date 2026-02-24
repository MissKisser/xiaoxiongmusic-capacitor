import os
import zipfile
import sys
from pathlib import Path

def create_zip_excluding_folders(source_dir, output_zip, exclude_folders):
    """
    打包目录，排除指定文件夹
    
    Args:
        source_dir: 源目录路径
        output_zip: 输出的zip文件路径
        exclude_folders: 要排除的文件夹列表（相对路径）
    """
    source_path = Path(source_dir).resolve()
    output_path = Path(output_zip).resolve()
    
    print(f"源目录: {source_path}")
    print(f"输出文件: {output_path}")
    print(f"排除的文件夹: {exclude_folders}")
    
    # 转换为绝对路径用于比较
    exclude_paths = [source_path / folder for folder in exclude_folders]
    
    try:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(source_path):
                current_path = Path(root)
                
                # 检查当前目录是否在排除列表中
                should_exclude = False
                for exclude_path in exclude_paths:
                    if exclude_path in current_path.parents or current_path == exclude_path:
                        should_exclude = True
                        break
                
                if should_exclude:
                    # 跳过这个目录及其所有子目录
                    dirs[:] = []  # 清空dirs列表，停止遍历子目录
                    continue
                
                # 添加文件到zip
                for file in files:
                    file_path = current_path / file
                    arcname = file_path.relative_to(source_path)
                    zipf.write(file_path, arcname)
                    
                # 添加空目录（保持目录结构）
                for dir_name in dirs:
                    dir_path = current_path / dir_name
                    # 检查目录是否为空且不在排除列表中
                    if not any(dir_path.iterdir()):
                        arcname = dir_path.relative_to(source_path)
                        zipf.write(dir_path, arcname)
        
        # 计算zip文件大小
        zip_size = output_path.stat().st_size
        print(f"\n打包完成！")
        print(f"ZIP文件大小: {zip_size / 1024 / 1024:.2f} MB")
        
    except Exception as e:
        print(f"打包失败: {e}")
        sys.exit(1)

if __name__ == "__main__":
    # 配置参数
    source_directory = r"D:\document\xiaoxiongmusic\Mobile"
    output_zip_file = r"D:\document\xiaoxiongmusic\Mobile.zip"
    
    # 要排除的文件夹（相对路径）
    exclude_list = [
        "node_modules",
        "android/app/build"
    ]
    
    # 检查源目录是否存在
    if not os.path.exists(source_directory):
        print(f"错误: 源目录不存在 - {source_directory}")
        sys.exit(1)
    
    # 执行打包
    create_zip_excluding_folders(source_directory, output_zip_file, exclude_list)

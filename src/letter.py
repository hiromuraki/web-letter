from pydantic import BaseModel
from pathlib import Path


class Letter(BaseModel):
    title: str
    content: str
    sign: str

    @classmethod
    def load(cls, letter_file_path: Path | str) -> Letter:
        path = Path(letter_file_path)
        if not path.exists():
            raise FileNotFoundError(f"找不到信件文件: {path}")

        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        title = ""
        sign = ""
        content_lines = []
        is_content_section = False

        for line in lines:
            line = line.strip()  # 去除首尾空格和换行符

            # 还没进入正文区域时，解析头部信息
            if not is_content_section:
                if line.startswith("TITLE:"):
                    title = line[len("TITLE:") :].strip()
                elif line.startswith("SIGN:"):
                    sign = line[len("SIGN:") :].strip()
                elif line == "":
                    # 遇到第一个空行，且 title 和 sign 已获取，进入正文解析阶段
                    if title and sign:
                        is_content_section = True
            else:
                # 进入正文后：
                # 1. 忽略行间空格 (if line 确保了不会把空行加进列表)
                if line:
                    content_lines.append(line)

        # 2. 用 \n 链接所有段落
        content = "\n".join(content_lines)

        return cls(title=title, content=content, sign=sign)

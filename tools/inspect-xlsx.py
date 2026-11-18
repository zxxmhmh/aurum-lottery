from openpyxl import load_workbook
import sys

path = sys.argv[1]
wb = load_workbook(path, read_only=True, data_only=True)
print("sheets:", wb.sheetnames)
for ws in wb.worksheets:
    print("\n==", ws.title, "| rows:", ws.max_row, "| cols:", ws.max_column)
    for i, row in enumerate(ws.iter_rows(max_row=12, values_only=True)):
        cells = ["" if v is None else str(v)[:28] for v in row]
        while cells and cells[-1] == "":
            cells.pop()
        print(f"{i+1:>3}:", " | ".join(cells))
    if ws.max_row > 12:
        print("   ...")

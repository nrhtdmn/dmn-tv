import tkinter as tk
from tkinter import messagebox

def cevir():
    try:
        dakika = float(entry_dakika.get())
        saniye = dakika * 60
        label_sonuc.config(text=f"{saniye} saniye")
    except ValueError:
        messagebox.showerror("Hata", "Lütfen geçerli bir sayı girin!")

# Pencere
pencere = tk.Tk()
pencere.title("Dakika → Saniye")
pencere.geometry("300x200")
pencere.resizable(False, False)

# Etiket
label = tk.Label(pencere, text="Dakika giriniz:", font=("Arial", 12))
label.pack(pady=10)

# Giriş alanı
entry_dakika = tk.Entry(pencere, font=("Arial", 12))
entry_dakika.pack(pady=5)

# Buton
buton = tk.Button(pencere, text="Çevir", font=("Arial", 12), command=cevir)
buton.pack(pady=10)

# Sonuç etiketi
label_sonuc = tk.Label(pencere, text="", font=("Arial", 12, "bold"))
label_sonuc.pack(pady=10)

# Programı çalıştır
pencere.mainloop()